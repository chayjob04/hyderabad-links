using Microsoft.Extensions.Logging;

namespace BusinessDirectory.Api.Auth;

/// <summary>
/// `-- sms-test --phone +91XXXXXXXXXX` sends one real login code through MSG91 and reports what
/// MSG91 said.
///
/// It exists because there was no way to answer "are my MSG91 credentials right?" short of
/// deploying and asking a real person to try signing in — and when that failed, the only evidence
/// was a 503 and a log line. This runs the *same* `Msg91SmsSender` the API uses, with the same
/// configuration, so a pass here means the live path works rather than that something like it does.
///
/// Two things it deliberately does not do:
///   * **It never prints the code.** The point is to see whether the SMS arrives on the phone, and a
///     code echoed to a console is a code in a terminal history (CLAUDE.md).
///   * **It never stores a challenge.** Nothing here can be verified against; this tests delivery,
///     not sign-in. The number does not even need an account.
///
/// It sends a real SMS, which costs real money, so the number has to be typed in full. There is no
/// default and no "last used".
/// </summary>
public static class SmsTest
{
    public static int Run(IConfiguration configuration, string[] args)
    {
        var phone = Argument(args, "--phone");

        if (phone is null)
        {
            Console.Error.WriteLine(
                "Usage: dotnet run --project backend/BusinessDirectory.Api -- sms-test --phone +919876543210");
            Console.Error.WriteLine();
            Console.Error.WriteLine("Sends one real login code through MSG91 to that number. It costs money.");
            return 1;
        }

        if (!PhoneNumber.TryNormalizeIndia(phone, out var normalised))
        {
            Console.Error.WriteLine($"'{phone}' is not a valid Indian mobile number.");
            return 1;
        }

        var authKey = configuration["MSG91:AuthKey"];
        var templateId = configuration["MSG91:TemplateId"];

        // Checked here as well as in the sender, so the answer is a sentence rather than a stack
        // trace, and so it names which half is missing.
        if (string.IsNullOrWhiteSpace(authKey) || string.IsNullOrWhiteSpace(templateId))
        {
            Console.Error.WriteLine("MSG91 is not configured.");
            Console.Error.WriteLine($"  MSG91:AuthKey    {(string.IsNullOrWhiteSpace(authKey) ? "MISSING" : "set")}");
            Console.Error.WriteLine($"  MSG91:TemplateId {(string.IsNullOrWhiteSpace(templateId) ? "MISSING" : "set")}");
            Console.Error.WriteLine();
            Console.Error.WriteLine("Set both with user-secrets locally, or as App Service settings in Azure:");
            Console.Error.WriteLine("  dotnet user-secrets set \"MSG91:AuthKey\" \"...\" --project backend/BusinessDirectory.Api");
            return 1;
        }

        Console.WriteLine($"Sending a login code to {Msg91SmsSender.Mask(normalised)} through MSG91.");
        Console.WriteLine($"  template: {templateId}");
        Console.WriteLine("  the code is not printed here on purpose: look at the phone.");
        Console.WriteLine();

        // The same sender the API registers, with its own logging turned down to warnings so the
        // output is the result and not a request trace.
        using var loggerFactory = LoggerFactory.Create(logging => logging
            .AddSimpleConsole(options => options.SingleLine = true)
            .SetMinimumLevel(LogLevel.Information));

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        var sender = new Msg91SmsSender(http, configuration, loggerFactory.CreateLogger<Msg91SmsSender>());

        try
        {
            sender.SendOtpAsync(normalised, OtpCodes.Generate(), CancellationToken.None)
                  .GetAwaiter().GetResult();
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            Console.Error.WriteLine("FAILED.");
            Console.Error.WriteLine($"  {ex.Message}");
            Console.Error.WriteLine();
            Console.Error.WriteLine("What MSG91's usual refusals mean:");
            Console.Error.WriteLine("  'authkey' or 401        the auth key is wrong, or the account is suspended");
            Console.Error.WriteLine("  template not approved   the DLT template is not live yet on this account");
            Console.Error.WriteLine("  insufficient balance    top the account up");
            Console.Error.WriteLine("  invalid number          the number is not reachable on this route");
            return 1;
        }

        Console.WriteLine("MSG91 accepted it.");
        Console.WriteLine();
        Console.WriteLine("Accepted is not delivered. If no SMS arrives within a minute or two, the");
        Console.WriteLine("template's variables are the first thing to check: this sender passes the code");
        Console.WriteLine("as the `otp` parameter and also as Param2, so a template whose variable is named");
        Console.WriteLine("something else will send a message with an empty code in it.");
        return 0;
    }

    /// <summary>Reads `--name value` from the command line. Null when the flag is absent or last.</summary>
    private static string? Argument(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
