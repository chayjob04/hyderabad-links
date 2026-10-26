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
/// <param name="LiveModeApproved">
/// Whether live keys are allowed. <b>False by default, and that is the point.</b> Razorpay names its
/// keys <c>rzp_test_…</c> and <c>rzp_live_…</c>, so which mode a deployment is in is visible in the
/// key itself — and a live key charges a real card. Until the owner sets this, a live key is refused
/// and the subscription endpoints answer 503, which costs a lost sale; the alternative is taking real
/// money through a flow nobody has approved, which costs a refund and a complaint.
///
/// Set <c>Payments:LiveModeApproved=true</c> on the day live payments are approved, not before.
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
    bool LiveModeApproved,
    string PlanSlug,
    int PeriodMonths)
{
    public static PaymentSettings Load(IConfiguration configuration) => new(
        configuration["Payments:Provider"],
        configuration["Payments:KeyId"],
        configuration["Payments:KeySecret"],
        configuration["Payments:WebhookSecret"],
        configuration.GetValue("Payments:LiveModeApproved", false),
        configuration.GetValue("Payments:PlanSlug", "verified")!,
        configuration.GetValue("Payments:PeriodMonths", 12));

    /// <summary>
    /// Whether the configured key is a live one. Razorpay puts the mode in the key id, so this is
    /// read from the key rather than from a separate setting that could disagree with it.
    /// </summary>
    public bool IsLiveKey => KeyId?.StartsWith("rzp_live", StringComparison.OrdinalIgnoreCase) == true;

    /// <summary>
    /// A live key that has not been approved. Kept separate from <see cref="IsConfigured"/> so the
    /// startup warning can say which of the two problems it is, rather than "payments are off".
    /// </summary>
    public bool LiveModeBlocked => IsLiveKey && !LiveModeApproved;

    /// <summary>
    /// Whether an order can be created and its signature checked. Both halves of the key pair are
    /// required: a key id alone opens a checkout that nothing can then verify, which is the one
    /// outcome worth refusing outright — it ends with a customer charged and no subscription.
    ///
    /// A live key without <see cref="LiveModeApproved"/> is refused here too, so an unapproved live
    /// key cannot take a payment. The endpoints already answer 503 when this is false, so the refusal
    /// needs no separate path through them: it reaches a customer as "this is not available yet",
    /// which is true, and never as a real charge nobody approved.
    /// </summary>
    public bool IsConfigured =>
        string.Equals(Provider, "razorpay", StringComparison.OrdinalIgnoreCase)
        && !string.IsNullOrWhiteSpace(KeyId)
        && !string.IsNullOrWhiteSpace(KeySecret)
        && !LiveModeBlocked;

    /// <summary>
    /// Whether a webhook delivery can be authenticated. Separate from <see cref="IsConfigured"/>:
    /// webhooks are configured in Razorpay's dashboard with their own secret, and an unverifiable
    /// delivery must be refused rather than trusted.
    /// </summary>
    public bool WebhooksConfigured => !string.IsNullOrWhiteSpace(WebhookSecret);
}
