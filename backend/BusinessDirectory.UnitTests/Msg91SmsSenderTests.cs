using System.Net;
using BusinessDirectory.Api.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace BusinessDirectory.UnitTests;

// MSG91 has never been sent a real OTP from this project: a test that sends one costs money and
// goes to a real phone. What can be established without that is the part that is ours — that the
// request carries what MSG91's v5 API expects, that the auth key travels as a header, that a
// refusal is a failure rather than a silent success, and the one that matters most:
//
//   **the code never reaches a log line.**
//
// That last one is not hypothetical. MSG91 takes the OTP as a query parameter, and
// HttpClientFactory's own logging writes the request URI at Information level, so the default
// wiring would write every live OTP and the number it went to into the application log. The test
// below fails if that wiring ever comes back.
public class Msg91SmsSenderTests
{
    private const string AuthKey = "test_auth_key_not_a_real_key";
    private const string TemplateId = "test_template_id";
    private const string Code = "428913";
    private const string Phone = "+919876500123";

    private static IConfiguration Configuration(string? authKey = AuthKey, string? templateId = TemplateId) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["MSG91:AuthKey"] = authKey,
            ["MSG91:TemplateId"] = templateId,
        }).Build();

    private sealed class CapturingHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? RequestBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent(body) };
        }
    }

    /// <summary>Keeps every log message, so a test can check what was and was not written.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<string> messages = [];

        public string Written
        {
            get { lock (messages) { return string.Join("\n", messages); } }
        }

        public ILogger CreateLogger(string categoryName) => new Capturing(this);

        public void Dispose()
        {
        }

        private void Add(string message)
        {
            lock (messages) { messages.Add(message); }
        }

        private sealed class Capturing(CapturingLoggerProvider owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter) => owner.Add(formatter(state, exception));
        }
    }

    private static (Msg91SmsSender Sender, CapturingHandler Handler) Build(
        HttpStatusCode status = HttpStatusCode.OK,
        string body = """{"type":"success","message":"3241..."}""",
        IConfiguration? configuration = null)
    {
        var handler = new CapturingHandler(status, body);
        var loggerFactory = LoggerFactory.Create(logging => logging.SetMinimumLevel(LogLevel.Trace));
        return (
            new Msg91SmsSender(
                new HttpClient(handler),
                configuration ?? Configuration(),
                loggerFactory.CreateLogger<Msg91SmsSender>()),
            handler);
    }

    [Fact]
    public async Task The_request_carries_the_template_the_number_and_the_code()
    {
        var (sender, handler) = Build();

        await sender.SendOtpAsync(Phone, Code, CancellationToken.None);

        Assert.Equal(HttpMethod.Post, handler.Request!.Method);
        var uri = handler.Request.RequestUri!.ToString();
        Assert.StartsWith("https://control.msg91.com/api/v5/otp", uri);
        Assert.Contains($"template_id={TemplateId}", uri);
        // MSG91 wants the number without the +, which is the one transformation this sender makes.
        Assert.Contains("mobile=919876500123", uri);
        Assert.DoesNotContain("%2B", uri);
    }

    [Fact]
    public async Task The_auth_key_travels_as_a_header_and_not_in_the_url()
    {
        var (sender, handler) = Build();

        await sender.SendOtpAsync(Phone, Code, CancellationToken.None);

        Assert.Equal(AuthKey, handler.Request!.Headers.GetValues("authkey").Single());
        Assert.DoesNotContain(AuthKey, handler.Request.RequestUri!.ToString());
    }

    // ------------------------------------------------------------------ the logging rule
    [Fact]
    public async Task The_code_never_reaches_a_log_line()
    {
        var log = new CapturingLoggerProvider();
        using var loggerFactory = LoggerFactory.Create(logging =>
        {
            logging.SetMinimumLevel(LogLevel.Trace);
            logging.AddProvider(log);
        });

        var handler = new CapturingHandler(HttpStatusCode.OK, """{"type":"success"}""");
        var sender = new Msg91SmsSender(
            new HttpClient(handler), Configuration(), loggerFactory.CreateLogger<Msg91SmsSender>());

        await sender.SendOtpAsync(Phone, Code, CancellationToken.None);

        var written = log.Written;
        Assert.DoesNotContain(Code, written);
        Assert.DoesNotContain(AuthKey, written);
        // The full number is not written either: a log is readable by more people, and for far
        // longer, than a five-minute code or a sign-in record should be.
        Assert.DoesNotContain(Phone, written);
        Assert.Contains("+91******0123", written);
    }

    [Fact]
    public async Task The_http_client_factory_loggers_are_removed_so_the_url_is_not_written()
    {
        /* The real wiring, which Program.cs builds with RemoveAllLoggers: nothing about this
           request reaches the log, not the code and not the address it went to. */
        var log = new CapturingLoggerProvider();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(Configuration());
        services.AddLogging(logging =>
        {
            logging.SetMinimumLevel(LogLevel.Trace);
            logging.AddProvider(log);
        });
        services.AddHttpClient<ISmsSender, Msg91SmsSender>()
            .RemoveAllLoggers()
            .ConfigurePrimaryHttpMessageHandler(() => new CapturingHandler(HttpStatusCode.OK, """{"type":"success"}"""));

        using var provider = services.BuildServiceProvider();
        await provider.GetRequiredService<ISmsSender>().SendOtpAsync(Phone, Code, CancellationToken.None);

        var written = log.Written;
        Assert.DoesNotContain(Code, written);
        Assert.DoesNotContain("control.msg91.com", written);
    }

    [Fact]
    public async Task Even_the_default_loggers_redact_the_query_string_that_carries_the_code()
    {
        /* This test was written the other way round first, asserting that the default wiring *does*
           leak the OTP — MSG91 takes it as a query parameter, and HttpClientFactory logs the
           request URI, so the reasoning looked sound. It failed, and the failure was the useful
           part: since .NET 8 the runtime redacts query strings in that log line, so the code never
           reached it and there was no leak to fix.

           It is kept, inverted, for two reasons. It records what was actually checked rather than
           what was assumed, and it is a real assertion: were that redaction ever configured off, or
           dropped by a future runtime, this fails and says exactly what has changed.

           RemoveAllLoggers in Program.cs stays as well. It costs one line, it removes the
           dependency on a framework behaviour this project does not control, and the sender's own
           logging — code never included, number masked — is what is wanted here anyway. */
        var log = new CapturingLoggerProvider();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(Configuration());
        services.AddLogging(logging =>
        {
            logging.SetMinimumLevel(LogLevel.Trace);
            logging.AddProvider(log);
        });
        services.AddHttpClient<ISmsSender, Msg91SmsSender>()
            .ConfigurePrimaryHttpMessageHandler(() => new CapturingHandler(HttpStatusCode.OK, """{"type":"success"}"""));

        using var provider = services.BuildServiceProvider();
        await provider.GetRequiredService<ISmsSender>().SendOtpAsync(Phone, Code, CancellationToken.None);

        var written = log.Written;
        Assert.Contains("Start processing HTTP request", written);   // the loggers really did run
        Assert.DoesNotContain(Code, written);
        Assert.DoesNotContain("otp=", written);
    }

    // ------------------------------------------------------------------ refusals
    [Fact]
    public async Task A_missing_key_or_template_is_a_failure_rather_than_a_silent_skip()
    {
        var (noKey, _) = Build(configuration: Configuration(authKey: null));
        var (noTemplate, _) = Build(configuration: Configuration(templateId: " "));

        await Assert.ThrowsAsync<InvalidOperationException>(() => noKey.SendOtpAsync(Phone, Code, CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(() => noTemplate.SendOtpAsync(Phone, Code, CancellationToken.None));
    }

    [Theory]
    [InlineData("9876500123", "428913")]   // no country prefix
    [InlineData("+919876500123", "42891")] // five digits
    [InlineData("+919876500123", "4289a3")]
    public async Task A_malformed_number_or_code_is_refused_before_anything_is_sent(string phone, string code)
    {
        var (sender, handler) = Build();

        await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendOtpAsync(phone, code, CancellationToken.None));

        Assert.Null(handler.Request);
    }

    [Fact]
    public async Task An_http_failure_throws_so_the_owner_is_not_told_a_code_was_sent()
    {
        var (sender, _) = Build(HttpStatusCode.Unauthorized, "unauthorised");

        await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendOtpAsync(Phone, Code, CancellationToken.None));
    }

    [Fact]
    public async Task A_200_that_is_not_a_success_is_still_a_failure()
    {
        // MSG91 answers 200 with {"type":"error"} for a rejected template or an invalid number.
        // Treating that as sent is how an owner ends up waiting for a code that is not coming.
        var (sender, _) = Build(HttpStatusCode.OK, """{"type":"error","message":"template not approved"}""");

        await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendOtpAsync(Phone, Code, CancellationToken.None));
    }

    [Fact]
    public async Task A_response_that_is_not_json_is_a_failure()
    {
        var (sender, _) = Build(HttpStatusCode.OK, "<html>maintenance</html>");

        await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendOtpAsync(Phone, Code, CancellationToken.None));
    }

    [Theory]
    [InlineData("+919876500123", "+91******0123")]
    [InlineData("+15551234567", "+15*****4567")]
    [InlineData("+9112", "+91******")]
    public void The_mask_keeps_the_prefix_and_the_last_four_digits(string phone, string expected) =>
        Assert.Equal(expected, Msg91SmsSender.Mask(phone));
// ------------------------------------------------------------------ the provider's own reason
    [Fact]
    public async Task A_rejection_carries_what_MSG91_actually_said()
    {
        /* This is the test for the thing that made MSG91 hard to diagnose: the old sender threw
           "MSG91 could not send the OTP." for every failure, so an unapproved template, a wrong
           auth key and an empty balance were indistinguishable. The body below is the real shape
           MSG91 returns for a bad key — a 200 with type "error". */
        var (sender, _) = Build(
            HttpStatusCode.OK, """{"request_id":"Invalid authkey or Token","type":"error"}""");

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(
            () => sender.SendOtpAsync(Phone, Code, CancellationToken.None));

        Assert.Contains("Invalid authkey or Token", failure.Message);
    }

    [Fact]
    public async Task An_http_failure_carries_the_status_and_the_body()
    {
        var (sender, _) = Build(HttpStatusCode.Unauthorized, """{"message":"template not approved"}""");

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(
            () => sender.SendOtpAsync(Phone, Code, CancellationToken.None));

        Assert.Contains("401", failure.Message);
        Assert.Contains("template not approved", failure.Message);
    }

    [Fact]
    public async Task The_reason_never_includes_the_auth_key_or_the_code()
    {
        // The reason is MSG91's own body, so neither should ever appear — but this is the one
        // message that now travels further than a log line, so it is worth pinning.
        var (sender, _) = Build(HttpStatusCode.BadRequest, """{"message":"something went wrong"}""");

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(
            () => sender.SendOtpAsync(Phone, Code, CancellationToken.None));

        Assert.DoesNotContain(AuthKey, failure.Message);
        Assert.DoesNotContain(Code, failure.Message);
    }

    [Fact]
    public async Task A_huge_error_page_is_capped()
    {
        var (sender, _) = Build(HttpStatusCode.BadGateway, new string('x', 5_000));

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(
            () => sender.SendOtpAsync(Phone, Code, CancellationToken.None));

        Assert.True(failure.Message.Length < 500, $"The message was {failure.Message.Length} characters long.");
    }

    [Fact]
    public async Task The_providers_request_id_is_logged_on_success_but_the_code_still_is_not()
    {
        // The request id is what MSG91's support asks for when a message was accepted and never
        // arrived, so it is worth keeping. It is not a secret and is useless without the account.
        var log = new CapturingLoggerProvider();
        using var loggerFactory = LoggerFactory.Create(logging =>
        {
            logging.SetMinimumLevel(LogLevel.Trace);
            logging.AddProvider(log);
        });

        var handler = new CapturingHandler(
            HttpStatusCode.OK, """{"type":"success","request_id":"3241abc-TESTONLY"}""");
        var sender = new Msg91SmsSender(
            new HttpClient(handler), Configuration(), loggerFactory.CreateLogger<Msg91SmsSender>());

        await sender.SendOtpAsync(Phone, Code, CancellationToken.None);

        var written = log.Written;
        Assert.Contains("3241abc-TESTONLY", written);
        Assert.DoesNotContain(Code, written);
        Assert.DoesNotContain(AuthKey, written);
    }
}
