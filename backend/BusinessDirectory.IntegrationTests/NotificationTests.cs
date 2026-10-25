using System.Net;
using System.Net.Http.Json;
using BusinessDirectory.Api.Notifications;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace BusinessDirectory.IntegrationTests;

// How notifications are wired up, with no database — CI runs these without one.
//
// What is testable here is the part that decides whether anything can be sent at all: which sender
// the environment gets, that an unconfigured one refuses loudly instead of pretending, that the
// `Email:` configuration is actually read, and that the endpoints which now notify still answer the
// same way to callers who have no business calling them.
//
// What is *not* here: that a real provider delivers anything. No provider is configured (decision
// D14), so there is nothing to test and nothing is claimed. The storage rules are in
// database/sqlserver/checks/notification_smoke.sql, and the console sender was exercised against the running
// API with a real enquiry — see docs/PROJECT_STATUS.md.
public class NotificationTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    /// <summary>
    /// Outside Development the API refuses to start without its signing keys, so a test that pins
    /// the environment has to supply them. These are 32 zero bytes: throwaway values for a host that
    /// signs nothing in these tests, never a key that exists anywhere else.
    /// </summary>
    private const string ThrowawayKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    /// <summary>A factory pinned to one environment, so "which sender" is not left to the test host.</summary>
    private WebApplicationFactory<Program> In(string environment, params (string Key, string Value)[] settings) =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("Auth:JwtSigningKey", ThrowawayKey);
            builder.UseSetting("Auth:OtpHmacKey", ThrowawayKey);
            builder.UseSetting("Auth:TotpEncryptionKey", ThrowawayKey);
            // The endpoints take SqlDatabase as a service, and it is only registered when a
            // connection string exists. Nothing here opens a connection — creating a data source
            // does not — but without the string the routes would not even map.
            // SQL Server keywords, not PostgreSQL's. This said Host=/Username= until now, left over
            // from before the conversion: a leftover that still worked, because nothing parses it
            // unless a query runs, but it contradicted "no PostgreSQL left in testing" and would
            // have thrown rather than failed to connect if anything ever had.
            builder.UseSetting(
                "ConnectionStrings:Default",
                "Server=127.0.0.1,1;Database=unused;User Id=unused;Password=unused;"
                + "Encrypt=False;TrustServerCertificate=True;Connect Timeout=1");
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }
        });

    // ------------------------------------------------------------------ which sender, where
    [Fact]
    public void Development_gets_the_console_sender()
    {
        using var development = In(Environments.Development);

        var sender = development.Services.GetRequiredService<IEmailSender>();

        Assert.IsType<ConsoleEmailSender>(sender);
        Assert.True(sender.IsConfigured);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void Everywhere_else_gets_the_unconfigured_sender(string environment)
    {
        using var app = In(environment);

        var sender = app.Services.GetRequiredService<IEmailSender>();

        Assert.IsType<UnconfiguredEmailSender>(sender);
        Assert.False(sender.IsConfigured);
    }

    [Fact]
    public async Task The_unconfigured_sender_refuses_loudly_rather_than_pretending()
    {
        using var app = In(Environments.Production);
        var sender = app.Services.GetRequiredService<IEmailSender>();

        // Returning quietly would let the API report that an owner was told something when nobody
        // was. The throw is what the Notifier records as a failed notification.
        var failure = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sender.SendAsync(new EmailMessage("owner@example.com", "Subject", "Text", "<p>Html</p>"), CancellationToken.None));

        Assert.Contains("Email:Provider", failure.Message);
    }

    [Fact]
    public async Task The_console_sender_writes_the_message_and_not_the_api_key()
    {
        var log = new CapturingLoggerProvider();
        using var app = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Development);
            builder.UseSetting("Email:ApiKey", "re_test_key_do_not_log");
            builder.ConfigureLogging(logging => logging.AddProvider(log));
        });

        var sender = app.Services.GetRequiredService<IEmailSender>();
        await sender.SendAsync(
            new EmailMessage("owner@example.com", "New enquiry for Ravi Plumbing", "A customer wrote in.", "<p>ignored</p>"),
            CancellationToken.None);

        var written = string.Join("\n", log.Messages);
        Assert.Contains("owner@example.com", written);
        Assert.Contains("New enquiry for Ravi Plumbing", written);
        Assert.Contains("A customer wrote in.", written);
        // The one thing that must never reach a log line.
        Assert.DoesNotContain("re_test_key_do_not_log", written);
    }

    // ------------------------------------------------------------------ configuration
    [Fact]
    public void The_email_settings_come_from_configuration()
    {
        using var app = In(
            Environments.Production,
            ("Email:Provider", "resend"),
            ("Email:ApiKey", "re_test_key"),
            ("Email:FromAddress", "no-reply@hyderabadlinks.com"),
            ("Email:ReplyTo", "hello@hyderabadlinks.com"),
            ("Email:SiteBaseUrl", "https://hyderabadlinks.com"));

        var settings = app.Services.GetRequiredService<EmailSettings>();

        Assert.Equal("resend", settings.Provider);
        Assert.Equal("re_test_key", settings.ApiKey);
        Assert.Equal("no-reply@hyderabadlinks.com", settings.FromAddress);
        Assert.Equal("hello@hyderabadlinks.com", settings.ReplyTo);
        Assert.Equal("https://hyderabadlinks.com", settings.SiteBaseUrl);
    }

    [Fact]
    public void Nothing_about_email_is_hardcoded()
    {
        // With nothing configured, every value is simply absent. No default sender address, no
        // default provider: an unset provider means email is not configured, which is honest.
        using var app = In(Environments.Production);

        var settings = app.Services.GetRequiredService<EmailSettings>();

        Assert.Null(settings.Provider);
        Assert.Null(settings.ApiKey);
        Assert.Null(settings.FromAddress);
        Assert.Null(settings.ReplyTo);
        Assert.Null(settings.SiteBaseUrl);
    }

    [Fact]
    public void The_notifier_passes_the_configured_site_address_to_the_templates()
    {
        using var configured = In(Environments.Production, ("Email:SiteBaseUrl", "https://hyderabadlinks.com"));
        Assert.Equal("https://hyderabadlinks.com", configured.Services.GetRequiredService<Notifier>().SiteBaseUrl);

        using var unconfigured = In(Environments.Production);
        // Null is what makes the templates leave links out instead of printing relative paths.
        Assert.Null(unconfigured.Services.GetRequiredService<Notifier>().SiteBaseUrl);
    }

    // ------------------------------------------------------------------ the endpoints that now notify
    [Fact]
    public async Task Sending_an_enquiry_still_validates_before_anything_is_notified()
    {
        // Notifying added a dependency to this handler. If that dependency could not be resolved
        // without a database, this would be a 500 instead of a validation problem.
        var response = await _client.PostAsJsonAsync(
            "/api/v1/public/listings/hyderabad/madhapur/some-business/enquiries",
            new { name = "", phone = "123", email = "nope", message = "hi" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("SqlClient", body);
        Assert.DoesNotContain("Email", body);
    }

    [Fact]
    public async Task Approving_a_listing_still_requires_an_admin_token()
    {
        var response = await _client.PostAsync("/api/v1/admin/listings/1/approve", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Rejecting_a_listing_still_requires_an_admin_token()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/admin/listings/1/reject", new { reason = "Not a real business." });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>Keeps every log message the app wrote, so a test can check what was and was not in it.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<string> messages = [];

        public IReadOnlyList<string> Messages
        {
            get { lock (messages) { return messages.ToArray(); } }
        }

        public ILogger CreateLogger(string categoryName) => new Capturing(this);

        public void Dispose()
        {
        }

        private void Add(string message)
        {
            lock (messages)
            {
                messages.Add(message);
            }
        }

        private sealed class Capturing(CapturingLoggerProvider owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter) =>
                owner.Add(formatter(state, exception));
        }
    }
}
