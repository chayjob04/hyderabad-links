using BusinessDirectory.Api.Payments;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace BusinessDirectory.UnitTests;

// What "configured" means, and that a half-configuration counts as not configured. This matters
// more here than it does for email: an unsendable email is a failed notification row, while a
// checkout that opens and cannot then be verified is a customer charged for nothing.
//
// No real key appears below.
public class PaymentSettingsTests
{
    private static PaymentSettings Load(params (string Key, string? Value)[] settings) =>
        PaymentSettings.Load(new ConfigurationBuilder()
            .AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))
            .Build());

    [Fact]
    public void Nothing_about_payments_is_hardcoded()
    {
        var settings = Load();

        Assert.Null(settings.Provider);
        Assert.Null(settings.KeyId);
        Assert.Null(settings.KeySecret);
        Assert.Null(settings.WebhookSecret);
        Assert.False(settings.IsConfigured);
        Assert.False(settings.WebhooksConfigured);
    }

    [Fact]
    public void The_plan_and_period_have_defaults_because_they_are_not_secrets()
    {
        // The slug and the period are product facts, not credentials: 'verified' is the only paid
        // plan S0009 leaves active, and the plan is sold by the year.
        var settings = Load();

        Assert.Equal("verified", settings.PlanSlug);
        Assert.Equal(12, settings.PeriodMonths);
    }

    [Fact]
    public void A_full_configuration_is_configured()
    {
        var settings = Load(
            ("Payments:Provider", "razorpay"),
            ("Payments:KeyId", "rzp_test_key_id"),
            ("Payments:KeySecret", "test_secret"),
            ("Payments:WebhookSecret", "test_webhook_secret"));

        Assert.True(settings.IsConfigured);
        Assert.True(settings.WebhooksConfigured);
    }

    [Theory]
    [InlineData(null, "test_secret")]
    [InlineData("rzp_test_key_id", null)]
    [InlineData("", "test_secret")]
    [InlineData("rzp_test_key_id", "   ")]
    public void Half_a_key_pair_is_not_configured(string? keyId, string? keySecret)
    {
        var settings = Load(
            ("Payments:Provider", "razorpay"),
            ("Payments:KeyId", keyId),
            ("Payments:KeySecret", keySecret));

        Assert.False(settings.IsConfigured);
    }

    [Fact]
    public void Keys_without_a_provider_are_not_configured()
    {
        // Leaving the keys in place is how a provider gets switched off deliberately, so the
        // provider line alone must decide it.
        var settings = Load(
            ("Payments:KeyId", "rzp_test_key_id"),
            ("Payments:KeySecret", "test_secret"));

        Assert.False(settings.IsConfigured);
    }

    [Fact]
    public void An_unknown_provider_is_not_configured()
    {
        var settings = Load(
            ("Payments:Provider", "some-other-gateway"),
            ("Payments:KeyId", "key"),
            ("Payments:KeySecret", "secret"));

        Assert.False(settings.IsConfigured);
    }

    [Fact]
    public void Webhooks_are_configured_separately_from_the_key_pair()
    {
        // They are different secrets, and a deployment really can have one without the other.
        var keysOnly = Load(
            ("Payments:Provider", "razorpay"),
            ("Payments:KeyId", "rzp_test_key_id"),
            ("Payments:KeySecret", "test_secret"));

        Assert.True(keysOnly.IsConfigured);
        Assert.False(keysOnly.WebhooksConfigured);
    }

    // ------------------------------------------------------------------ the gateway itself
    [Fact]
    public async Task The_unconfigured_gateway_refuses_loudly_rather_than_pretending()
    {
        var gateway = new UnconfiguredPaymentGateway();

        Assert.False(gateway.IsConfigured);
        Assert.Null(gateway.PublishableKeyId);

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            gateway.CreateOrderAsync(39900, "INR", "receipt", new Dictionary<string, string>(), CancellationToken.None));
        Assert.Contains("Payments:Provider", failure.Message);
    }

    [Fact]
    public async Task A_half_configured_razorpay_gateway_refuses_before_it_calls_anything()
    {
        // No HTTP handler is given, so if this ever did reach the network the test would fail
        // rather than quietly succeed against a real endpoint.
        var gateway = new RazorpayGateway(
            new HttpClient(new ThrowingHandler()),
            Load(("Payments:Provider", "razorpay"), ("Payments:KeyId", "rzp_test_key_id")),
            NullLogger<RazorpayGateway>.Instance);

        Assert.False(gateway.IsConfigured);
        Assert.Null(gateway.PublishableKeyId);

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            gateway.CreateOrderAsync(39900, "INR", "receipt", new Dictionary<string, string>(), CancellationToken.None));
        Assert.Contains("Payments:KeySecret", failure.Message);
    }

    /// <summary>Fails the test if anything tries to leave the machine.</summary>
    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            throw new InvalidOperationException("No HTTP request should have been made.");
    }
}
