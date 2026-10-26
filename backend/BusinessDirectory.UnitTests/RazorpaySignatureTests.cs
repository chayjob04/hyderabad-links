using System.Security.Cryptography;
using System.Text;
using BusinessDirectory.Api.Payments;

namespace BusinessDirectory.UnitTests;

// The signature check is the only thing in this project that decides a payment was real, so it is
// the one part of payments that is worth testing hardest — and, usefully, the one part that needs no
// provider account: HMAC-SHA256 is deterministic, so the expected value can be computed here
// independently and compared with what the API computes.
//
// No real key appears below. Every secret is an obvious test string, and none of them has ever
// authenticated anything.
public class RazorpaySignatureTests
{
    private const string Secret = "test_secret_not_a_real_key";
    private const string OrderId = "order_TESTONLY00001";
    private const string PaymentId = "pay_TESTONLY00001";

    /// <summary>Computed here with the framework directly, so the test does not prove the code against itself.</summary>
    private static string Hmac(string payload, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    [Fact]
    public void A_checkout_signature_over_order_pipe_payment_is_accepted()
    {
        // Razorpay signs exactly "order_id|payment_id" with the API key secret. Getting the
        // separator or the order of the two halves wrong would accept nothing at all in production,
        // which is why the payload is spelled out here rather than taken from the code under test.
        var signature = Hmac($"{OrderId}|{PaymentId}", Secret);

        Assert.True(RazorpaySignature.IsValidCheckout(OrderId, PaymentId, signature, Secret));
    }

    [Fact]
    public void The_two_halves_cannot_be_swapped()
    {
        var signature = Hmac($"{PaymentId}|{OrderId}", Secret);

        Assert.False(RazorpaySignature.IsValidCheckout(OrderId, PaymentId, signature, Secret));
    }

    [Fact]
    public void A_signature_from_another_secret_is_refused()
    {
        var signature = Hmac($"{OrderId}|{PaymentId}", "a_different_secret");

        Assert.False(RazorpaySignature.IsValidCheckout(OrderId, PaymentId, signature, Secret));
    }

    [Fact]
    public void A_signature_for_another_payment_is_refused()
    {
        // The case that matters: a real, valid signature from one payment replayed against another
        // order. This is what binds a payment to the order it was made for.
        var signature = Hmac($"{OrderId}|pay_SOMEONEELSE", Secret);

        Assert.False(RazorpaySignature.IsValidCheckout(OrderId, PaymentId, signature, Secret));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-hex")]
    public void Missing_or_malformed_signatures_are_refused(string? signature) =>
        Assert.False(RazorpaySignature.IsValidCheckout(OrderId, PaymentId, signature, Secret));

    [Fact]
    public void A_missing_order_or_payment_id_is_refused()
    {
        // Without these there is nothing to bind a signature to, and a caller who omits one must not
        // be able to make the comparison succeed by also omitting the signature.
        Assert.False(RazorpaySignature.IsValidCheckout(null, PaymentId, Hmac($"|{PaymentId}", Secret), Secret));
        Assert.False(RazorpaySignature.IsValidCheckout(OrderId, null, Hmac($"{OrderId}|", Secret), Secret));
    }

    [Fact]
    public void With_no_secret_configured_nothing_verifies()
    {
        // The dangerous shape of this bug: an empty secret makes HMAC perfectly computable, so a
        // caller who knows the secret is empty could sign their own result. Both halves of the
        // comparison must refuse.
        var signature = Hmac($"{OrderId}|{PaymentId}", "");

        Assert.False(RazorpaySignature.IsValidCheckout(OrderId, PaymentId, signature, ""));
        Assert.False(RazorpaySignature.IsValidCheckout(OrderId, PaymentId, signature, null));
    }

    [Fact]
    public void An_upper_case_signature_is_still_accepted()
    {
        // Razorpay sends lower-case hex. Accepting the upper-case form costs nothing and avoids a
        // failure that would be very hard to read if a proxy or a client ever changed the case.
        var signature = Hmac($"{OrderId}|{PaymentId}", Secret).ToUpperInvariant();

        Assert.True(RazorpaySignature.IsValidCheckout(OrderId, PaymentId, signature, Secret));
    }

    // ---------------------------------------------------------------- webhook bodies
    private const string Body =
        """{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_X","order_id":"order_X","amount":39900}}}}""";

    [Fact]
    public void A_webhook_signature_over_the_raw_body_is_accepted() =>
        Assert.True(RazorpaySignature.IsValidWebhook(Body, Hmac(Body, Secret), Secret));

    [Fact]
    public void A_webhook_body_changed_by_one_character_is_refused()
    {
        // The whole reason the endpoint verifies the raw stream rather than a re-serialised object:
        // change the amount from 39900 to 100 and the signature no longer matches.
        var signature = Hmac(Body, Secret);
        var tampered = Body.Replace("39900", "100");

        Assert.False(RazorpaySignature.IsValidWebhook(tampered, signature, Secret));
    }

    [Fact]
    public void A_webhook_body_reformatted_without_changing_its_meaning_is_still_refused()
    {
        // Same JSON, different whitespace. It is refused, and that is correct — it is also the trap
        // that catches implementations which parse first and verify afterwards.
        var signature = Hmac(Body, Secret);
        var reformatted = Body.Replace(",", ", ");

        Assert.False(RazorpaySignature.IsValidWebhook(reformatted, signature, Secret));
    }

    [Fact]
    public void An_empty_webhook_body_or_secret_verifies_nothing()
    {
        Assert.False(RazorpaySignature.IsValidWebhook("", Hmac("", Secret), Secret));
        Assert.False(RazorpaySignature.IsValidWebhook(Body, Hmac(Body, ""), ""));
    }

    [Fact]
    public void The_webhook_secret_is_not_the_key_secret()
    {
        // They are different secrets in Razorpay's dashboard, and signing a body with the API key
        // secret must not be accepted as a webhook signature.
        Assert.False(RazorpaySignature.IsValidWebhook(Body, Hmac(Body, Secret), "webhook_secret_test"));
    }
}
