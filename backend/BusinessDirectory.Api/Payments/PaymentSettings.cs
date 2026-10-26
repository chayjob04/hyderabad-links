namespace BusinessDirectory.Api.Payments;

/// <summary>
/// How the ₹399 Verified plan is paid for. Configured under <c>Payments:</c> only, and with nothing
/// configured there is no provider at all: the subscription endpoints answer 503 rather than
/// pretending a payment could be taken. Nothing here has a production default.
/// </summary>
/// <param name="Provider">
/// <c>razorpay</c> is the only adapter written. The column default in S0009 is the same word, and
/// the provider choice is still the owner's to confirm (docs/decisions.md, D-pending): an unset
/// value means payments are off, which is honest.
/// </param>
/// <param name="KeyId">
/// The publishable key. It reaches the browser, because Razorpay's checkout script needs it — that
/// is what it is for, and it authorises nothing on its own.
/// </param>
/// <param name="KeySecret">
/// The secret half of the API key pair. Used to create orders and to verify the signature the
/// checkout hands back. A secret: user-secrets, Key Vault or an app setting, never a file.
/// </param>
/// <param name="WebhookSecret">
/// The separate secret Razorpay signs webhook bodies with. It is **not** the key secret, and a
/// deployment can have one without the other, so the two are checked separately.
/// </param>
/// <param name="PlanSlug">
/// Which plan a payment buys. The only paid plan is <c>verified</c> (S0009); the price and the name
/// are read from the <c>plans</c> table at request time, never hardcoded here, so changing the price
/// stays an UPDATE rather than a deploy.
/// </param>
/// <param name="PeriodMonths">
/// How long one payment buys. 12 for the yearly ₹399 plan. Configurable because a change of billing
/// period must not mean editing SQL.
/// </param>
public sealed record PaymentSettings(
    string? Provider,
    string? KeyId,
    string? KeySecret,
    string? WebhookSecret,
    string PlanSlug,
    int PeriodMonths)
{
    public static PaymentSettings Load(IConfiguration configuration) => new(
        configuration["Payments:Provider"],
        configuration["Payments:KeyId"],
        configuration["Payments:KeySecret"],
        configuration["Payments:WebhookSecret"],
        configuration.GetValue("Payments:PlanSlug", "verified")!,
        configuration.GetValue("Payments:PeriodMonths", 12));

    /// <summary>
    /// Whether an order can be created and its signature checked. Both halves of the key pair are
    /// required: a key id alone opens a checkout that nothing can then verify, which is the one
    /// outcome worth refusing outright — it ends with a customer charged and no subscription.
    /// </summary>
    public bool IsConfigured =>
        string.Equals(Provider, "razorpay", StringComparison.OrdinalIgnoreCase)
        && !string.IsNullOrWhiteSpace(KeyId)
        && !string.IsNullOrWhiteSpace(KeySecret);

    /// <summary>
    /// Whether a webhook delivery can be authenticated. Separate from <see cref="IsConfigured"/>:
    /// webhooks are configured in Razorpay's dashboard with their own secret, and an unverifiable
    /// delivery must be refused rather than trusted.
    /// </summary>
    public bool WebhooksConfigured => !string.IsNullOrWhiteSpace(WebhookSecret);
}
