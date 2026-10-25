using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace BusinessDirectory.Api.Notifications;

/// <summary>
/// Sends email through Resend's HTTP API (decision D14).
///
/// **This has never sent a real message.** It is written against Resend's documented
/// `POST /emails` contract so that it works the moment `Email:ApiKey` and `Email:FromAddress` are
/// set, but nothing in this project claims the integration works until a real email has gone out
/// and been received. Until then `Notifier` records every attempt, and a failure is a `failed`
/// notification row rather than a silent loss.
///
/// No SDK. One POST with a bearer token does not justify a dependency, and `AddHttpClient` already
/// gives the pooling and timeout handling an SDK would bring.
///
/// What it deliberately does *not* do: swallow a failure. A non-success response throws, carrying
/// the status and Resend's own message, because the whole point of the notifications table is that a
/// message nobody received is visible as such. The exception message never includes the API key.
/// </summary>
public sealed class ResendEmailSender(
    HttpClient client,
    EmailSettings settings,
    ILogger<ResendEmailSender> logger) : IEmailSender
{
    private const string Endpoint = "https://api.resend.com/emails";

    /// <summary>
    /// Both are required: a key with no verified From address cannot send, and an address with no key
    /// cannot authenticate. Reporting "configured" on half a configuration would make the caller
    /// skip its own fallback and then fail anyway.
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(settings.ApiKey) && !string.IsNullOrWhiteSpace(settings.FromAddress);

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            // The same shape of failure as UnconfiguredEmailSender, so a half-configured deployment
            // behaves like an unconfigured one instead of failing in some third way.
            throw new InvalidOperationException(
                "Resend is selected but Email:ApiKey and/or Email:FromAddress are not configured.");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint)
        {
            Content = JsonContent.Create(new ResendRequest(
                From: settings.FromAddress!,
                // Resend takes an array; this project never sends to more than one person at a time,
                // which is also why EmailMessage.To is a single address.
                To: [message.To],
                Subject: message.Subject,
                Text: message.TextBody,
                Html: message.HtmlBody,
                ReplyTo: string.IsNullOrWhiteSpace(settings.ReplyTo) ? null : [settings.ReplyTo!])),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiKey);

        using var response = await client.SendAsync(request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            // Resend explains refusals (an unverified domain, a malformed address) in the body, and
            // that explanation is the useful part of the notification row. Read it, but cap it: an
            // unexpected HTML error page should not become a megabyte of log.
            var body = await ReadShortBody(response, cancellationToken);

            throw new InvalidOperationException(
                $"Resend refused the message ({(int)response.StatusCode} {response.ReasonPhrase}). {body}".TrimEnd());
        }

        // The id is what makes a delivery traceable in Resend's own dashboard later.
        var accepted = await response.Content.ReadFromJsonAsync<ResendResponse>(cancellationToken);
        logger.LogInformation(
            "Email accepted by Resend. Subject: {Subject} | provider id: {Id}",
            message.Subject, accepted?.Id ?? "(none returned)");
    }

    private static async Task<string> ReadShortBody(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            return body.Length > 500 ? body[..500] : body;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return string.Empty;
        }
    }

    /// <summary>Resend's documented field names, which are snake_case for reply_to.</summary>
    private sealed record ResendRequest(
        [property: JsonPropertyName("from")] string From,
        [property: JsonPropertyName("to")] string[] To,
        [property: JsonPropertyName("subject")] string Subject,
        [property: JsonPropertyName("text")] string Text,
        [property: JsonPropertyName("html")] string Html,
        [property: JsonPropertyName("reply_to"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        string[]? ReplyTo);

    private sealed record ResendResponse([property: JsonPropertyName("id")] string? Id);
}
