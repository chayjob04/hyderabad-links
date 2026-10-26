using System.Security.Cryptography;
using System.Text;

namespace BusinessDirectory.Api.Payments;

/// <summary>
/// The two signatures Razorpay uses, and the only thing in this project that decides a payment was
/// real. Both are HMAC-SHA256 in lower-case hex, and both are compared in fixed time.
///
/// They sign different things with different secrets, which is why they are separate methods:
///   * the checkout hands the browser <c>razorpay_signature</c> over "<c>order_id|payment_id</c>",
///     signed with the **API key secret**;
///   * a webhook carries <c>X-Razorpay-Signature</c> over the **raw request body**, signed with the
///     **webhook secret** set in Razorpay's dashboard.
///
/// A webhook body must be verified byte for byte as it arrived. Parsing it to JSON and
/// re-serialising changes whitespace and key order, and the signature then never matches — which is
/// why the endpoint reads the raw stream and hands the string here before anything looks inside it.
/// </summary>
public static class RazorpaySignature
{
    /// <summary>
    /// Whether <paramref name="signature"/> is the one Razorpay's checkout would produce for this
    /// order and payment. Returns false on anything missing or malformed rather than throwing: a
    /// caller who forgot a field and an attacker guessing a signature both deserve the same answer.
    /// </summary>
    public static bool IsValidCheckout(string? orderId, string? paymentId, string? signature, string? keySecret)
    {
        if (string.IsNullOrWhiteSpace(orderId) || string.IsNullOrWhiteSpace(paymentId))
        {
            return false;
        }

        return Matches($"{orderId}|{paymentId}", signature, keySecret);
    }

    /// <summary>
    /// Whether <paramref name="signature"/> is the one Razorpay would send for this exact body.
    /// <paramref name="rawBody"/> must be the bytes as received.
    /// </summary>
    public static bool IsValidWebhook(string? rawBody, string? signature, string? webhookSecret)
    {
        if (string.IsNullOrEmpty(rawBody))
        {
            return false;
        }

        return Matches(rawBody, signature, webhookSecret);
    }

    /// <summary>The expected signature for a payload, as lower-case hex. Exposed for the tests.</summary>
    public static string Compute(string payload, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexStringLower(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload)));
    }

    private static bool Matches(string payload, string? signature, string? secret)
    {
        if (string.IsNullOrWhiteSpace(signature) || string.IsNullOrWhiteSpace(secret))
        {
            return false;
        }

        var expected = Compute(payload, secret);

        // Fixed time, so the comparison cannot be used to discover the signature one character at a
        // time. The length check first is safe: the length of a SHA-256 hex digest is not a secret.
        if (signature.Length != expected.Length)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(signature.ToLowerInvariant()),
            Encoding.ASCII.GetBytes(expected));
    }
}
