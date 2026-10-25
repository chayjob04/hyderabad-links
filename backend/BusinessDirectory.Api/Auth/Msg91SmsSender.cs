using System.Net.Http.Json;
using System.Text.Json;

namespace BusinessDirectory.Api.Auth;

public sealed class Msg91SmsSender(
    HttpClient httpClient,
    IConfiguration configuration,
    ILogger<Msg91SmsSender> logger) : ISmsSender
{
    public async Task SendOtpAsync(
        string phoneE164,
        string code,
        CancellationToken cancellationToken)
    {
        var authKey = configuration["MSG91:AuthKey"];
        var templateId = configuration["MSG91:TemplateId"];

        if (string.IsNullOrWhiteSpace(authKey) ||
            string.IsNullOrWhiteSpace(templateId))
        {
            throw new InvalidOperationException(
                "MSG91 Auth Key or Template ID is not configured.");
        }

        if (!phoneE164.StartsWith('+') ||
            code.Length != 6 ||
            !code.All(char.IsDigit))
        {
            throw new InvalidOperationException(
                "Invalid phone number or OTP.");
        }

        var mobile = phoneE164.TrimStart('+');

        var url =
            "https://control.msg91.com/api/v5/otp" +
            $"?template_id={Uri.EscapeDataString(templateId)}" +
            $"&mobile={Uri.EscapeDataString(mobile)}" +
            $"&otp={Uri.EscapeDataString(code)}" +
            "&otp_expiry=5&otp_length=6&realTimeResponse=1";

        using var request = new HttpRequestMessage(HttpMethod.Post, url);

        request.Headers.TryAddWithoutValidation("authkey", authKey);

        request.Content = JsonContent.Create(new
        {
            Param1 = "Hyderabad Links",
            Param2 = code,
            Param3 = "5 minutes"
        });

        using var response = await httpClient.SendAsync(
            request,
            cancellationToken);

        var responseBody = await response.Content.ReadAsStringAsync(
            cancellationToken);

        /* MSG91's own reason travels with the failure, which it did not before: the log said only
           "MSG91 rejected an OTP request" and the exception said only "could not send". That is the
           single hardest thing to diagnose about this integration — a template that is not
           DLT-approved, a sender id that does not belong to the account and an exhausted balance all
           look identical from the outside, and MSG91 explains each of them in the body.

           It is safe to carry: the body is MSG91's, never ours, so the auth key cannot appear in it,
           and the owner-facing response is a fixed "temporarily unavailable" message that never
           includes this. Capped, so an HTML error page does not become a megabyte of log. */
        if (!response.IsSuccessStatusCode)
        {
            var reason = Shorten(responseBody);

            logger.LogError(
                "MSG91 refused an OTP request ({StatusCode}). {Reason}",
                (int)response.StatusCode, reason);

            throw new InvalidOperationException(
                $"MSG91 could not send the OTP ({(int)response.StatusCode} {response.ReasonPhrase}). {reason}".TrimEnd());
        }

        string? type;
        string? providerMessage;
        string? requestId;
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;

            type = root.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : null;
            providerMessage = root.TryGetProperty("message", out var messageElement)
                ? messageElement.ToString()
                : null;
            requestId = root.TryGetProperty("request_id", out var idElement) ? idElement.ToString() : null;
        }
        catch (JsonException)
        {
            logger.LogError(
                "MSG91 returned something that is not JSON. {Reason}", Shorten(responseBody));

            throw new InvalidOperationException(
                $"MSG91 returned an invalid response. {Shorten(responseBody)}".TrimEnd());
        }

        /* A 200 with {"type":"error"} is MSG91's normal way of refusing, so treating any 200 as sent
           is how an owner ends up waiting for a code that was never going to arrive. */
        if (!string.Equals(type, "success", StringComparison.OrdinalIgnoreCase))
        {
            var reason = Shorten(providerMessage ?? responseBody);

            logger.LogError("MSG91 rejected an OTP request. {Reason}", reason);

            throw new InvalidOperationException(
                $"MSG91 rejected the OTP. {reason}".TrimEnd());
        }

        /* The request id is MSG91's own handle for this message. It is the first thing their
           support asks for when an SMS was accepted and never arrived, and it is the only part of
           the response worth keeping: not a secret, and useless without the account. */
        logger.LogInformation(
            "MSG91 accepted an OTP request for {Phone}. Provider request id: {RequestId}",
            Mask(phoneE164), requestId ?? "(none returned)");
    }

    /// <summary>
    /// The provider's own words, capped. MSG91's refusals are short; an unexpected HTML error page
    /// is not, and this ends up in a log line and a database-free exception message.
    /// </summary>
    private static string Shorten(string? body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return string.Empty;
        }

        var trimmed = body.Trim();
        return trimmed.Length > 300 ? trimmed[..300] : trimmed;
    }

    /// <summary>
    /// Enough of the number to recognise it in a log, not enough to be a record of who signed in.
    /// The same shape the admin site uses for a reviewer's number: +91******0123.
    /// </summary>
    public static string Mask(string phoneE164) =>
        phoneE164.Length <= 7 ? "+91******" : phoneE164[..3] + new string('*', phoneE164.Length - 7) + phoneE164[^4..];
}
