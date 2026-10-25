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

        if (!response.IsSuccessStatusCode)
        {
            logger.LogError(
                "MSG91 request failed with HTTP status {StatusCode}.",
                (int)response.StatusCode);

            throw new InvalidOperationException(
                "MSG91 could not send the OTP.");
        }

        try
        {
            using var document = JsonDocument.Parse(responseBody);

            var root = document.RootElement;

            var type = root.TryGetProperty("type", out var typeElement)
                ? typeElement.GetString()
                : null;

            if (!string.Equals(
                    type,
                    "success",
                    StringComparison.OrdinalIgnoreCase))
            {
                logger.LogWarning("MSG91 rejected an OTP request.");

                throw new InvalidOperationException(
                    "MSG91 could not send the OTP.");
            }
        }
        catch (JsonException)
        {
            logger.LogError(
                "MSG91 returned an unexpected response format.");

            throw new InvalidOperationException(
                "MSG91 returned an invalid response.");
        }

        logger.LogInformation(
            "MSG91 accepted an OTP request for {Phone}.",
            phoneE164);
    }
}
