using System.Net;
using System.Text.Json;
using BusinessDirectory.Api.Notifications;
using Microsoft.Extensions.Logging.Abstractions;

namespace BusinessDirectory.UnitTests;

// Resend has never been sent a real message from this project. What these tests can establish
// without one is the part that is ours: that a half-configuration is reported as not configured
// rather than attempted, that the request carries what Resend's API expects, that the key travels as
// a bearer token, and that a refusal throws with the reason rather than passing silently. Whether
// Resend then accepts the message is not something a test here can know.
public class ResendEmailSenderTests
{
    private static EmailSettings Settings(string? key = "re_test_key", string? from = "no-reply@example.com",
                                          string? replyTo = null) =>
        new("resend", key, from, replyTo, "https://example.com");

    private static EmailMessage Message() =>
        new("owner@example.com", "New enquiry for Ravi Kumar Plumbing", "Plain text body", "<p>HTML body</p>");

    /// <summary>Captures the one request instead of sending it, and answers with whatever the test wants.</summary>
    private sealed class CapturingHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? RequestBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);

            return new HttpResponseMessage(status) { Content = new StringContent(body) };
        }
    }

    private static (ResendEmailSender Sender, CapturingHandler Handler) Build(
        EmailSettings settings, HttpStatusCode status = HttpStatusCode.OK, string body = """{"id":"abc-123"}""")
    {
        var handler = new CapturingHandler(status, body);
        var sender = new ResendEmailSender(
            new HttpClient(handler), settings, NullLogger<ResendEmailSender>.Instance);
        return (sender, handler);
    }

    [Fact]
    public void A_key_and_a_from_address_together_count_as_configured() =>
        Assert.True(Build(Settings()).Sender.IsConfigured);

    [Theory]
    [InlineData(null, "no-reply@example.com")]
    [InlineData("re_test_key", null)]
    [InlineData(null, null)]
    [InlineData("   ", "no-reply@example.com")]
    public void Half_a_configuration_is_not_configured(string? key, string? from) =>
        // Reporting "configured" here would make a caller skip its own fallback and then fail anyway.
        Assert.False(Build(Settings(key, from)).Sender.IsConfigured);

    [Fact]
    public async Task Sending_without_configuration_throws_rather_than_returning_quietly()
    {
        var (sender, handler) = Build(Settings(key: null));

        await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendAsync(Message(), default));
        Assert.Null(handler.Request);   // and nothing was sent
    }

    [Fact]
    public async Task The_request_carries_what_Resend_expects()
    {
        var (sender, handler) = Build(Settings(replyTo: "hello@example.com"));

        await sender.SendAsync(Message(), default);

        Assert.NotNull(handler.Request);
        Assert.Equal(HttpMethod.Post, handler.Request!.Method);
        Assert.Equal("https://api.resend.com/emails", handler.Request.RequestUri!.ToString());
        Assert.Equal("Bearer", handler.Request.Headers.Authorization!.Scheme);
        Assert.Equal("re_test_key", handler.Request.Headers.Authorization.Parameter);

        using var sent = JsonDocument.Parse(handler.RequestBody!);
        var root = sent.RootElement;
        Assert.Equal("no-reply@example.com", root.GetProperty("from").GetString());
        Assert.Equal("owner@example.com", root.GetProperty("to")[0].GetString());
        Assert.Equal("New enquiry for Ravi Kumar Plumbing", root.GetProperty("subject").GetString());
        Assert.Equal("Plain text body", root.GetProperty("text").GetString());
        Assert.Equal("<p>HTML body</p>", root.GetProperty("html").GetString());
        Assert.Equal("hello@example.com", root.GetProperty("reply_to")[0].GetString());
    }

    [Fact]
    public async Task No_reply_to_is_left_out_of_the_request_entirely()
    {
        // Sending reply_to: null would have Resend either reject it or strip it; leaving the field
        // out is the documented way to say "no reply-to".
        var (sender, handler) = Build(Settings());

        await sender.SendAsync(Message(), default);

        using var sent = JsonDocument.Parse(handler.RequestBody!);
        Assert.False(sent.RootElement.TryGetProperty("reply_to", out _));
    }

    [Fact]
    public async Task A_refusal_throws_and_carries_the_status_and_the_reason()
    {
        var (sender, _) = Build(
            Settings(),
            HttpStatusCode.UnprocessableEntity,
            """{"message":"The example.com domain is not verified."}""");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendAsync(Message(), default));

        Assert.Contains("422", error.Message);
        Assert.Contains("not verified", error.Message);
    }

    [Fact]
    public async Task A_refusal_does_not_leak_the_api_key()
    {
        var (sender, _) = Build(Settings(), HttpStatusCode.Unauthorized, """{"message":"Invalid API key"}""");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendAsync(Message(), default));

        Assert.DoesNotContain("re_test_key", error.Message);
    }

    [Fact]
    public async Task An_enormous_error_body_is_truncated()
    {
        // A provider outage can answer with an HTML error page; that must not become a megabyte of
        // log line or notification row.
        var (sender, _) = Build(Settings(), HttpStatusCode.BadGateway, new string('x', 10_000));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => sender.SendAsync(Message(), default));

        Assert.True(error.Message.Length < 800, $"message was {error.Message.Length} characters");
    }

    [Fact]
    public async Task A_success_with_no_id_in_the_body_still_counts_as_sent() =>
        // Resend returns an id; if a future response shape omits it that is not a delivery failure,
        // and treating it as one would record a sent message as failed.
        await Build(Settings(), HttpStatusCode.OK, "{}").Sender.SendAsync(Message(), default);
}
