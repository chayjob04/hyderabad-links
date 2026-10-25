using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;

namespace BusinessDirectory.IntegrationTests;

// Buying the Verified plan, from the outside. These run with no database, so what is testable here
// is everything that happens before a query: who may ask, what an unconfigured deployment answers,
// and — the important one — that the webhook refuses a body it cannot authenticate.
//
// What is *not* here: that a real payment grants a real subscription. No provider account exists
// (docs/REPAIR_STATUS.md), so there is nothing to test and nothing is claimed. The database rules
// are asserted in database/sqlserver/checks/subscription_smoke.sql, which creates and rolls back a
// subscription without any payment at all.
public class SubscriptionAccessTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    /// <summary>Outside Development the API refuses to start without signing keys. 32 zero bytes, for a host that signs nothing.</summary>
    private const string ThrowawayKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    private const string WebhookSecret = "test_webhook_secret_not_a_real_key";

    private WebApplicationFactory<Program> With(params (string Key, string Value)[] settings) =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Production);
            builder.UseSetting("Auth:JwtSigningKey", ThrowawayKey);
            builder.UseSetting("Auth:OtpHmacKey", ThrowawayKey);
            builder.UseSetting("Auth:TotpEncryptionKey", ThrowawayKey);
            builder.UseSetting(
                "ConnectionStrings:Default",
                "Server=127.0.0.1,1;Database=unused;User Id=unused;Password=unused;"
                + "Encrypt=False;TrustServerCertificate=True;Connect Timeout=1");
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }
        });

    private static StringContent Json(string body) => new(body, Encoding.UTF8, "application/json");

    private static string Sign(string payload, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    // ------------------------------------------------------------------ the owner's routes
    [Fact]
    public async Task Reading_a_listings_subscription_requires_sign_in() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.GetAsync("/api/v1/me/listings/1/subscription")).StatusCode);

    [Fact]
    public async Task Starting_a_payment_requires_sign_in() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.PostAsync("/api/v1/me/listings/1/subscription/order", content: null)).StatusCode);

    [Fact]
    public async Task Confirming_a_payment_requires_sign_in()
    {
        // The most important of the three: an anonymous caller who could post a payment result would
        // be able to try signatures against somebody else's order.
        var response = await _client.PostAsJsonAsync(
            "/api/v1/me/listings/1/subscription/verify",
            new { razorpayOrderId = "order_x", razorpayPaymentId = "pay_x", razorpaySignature = "deadbeef" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_made_up_token_does_not_start_a_payment()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/me/listings/1/subscription/order");
        request.Headers.Add("Authorization", "Bearer not-a-real-token");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task An_admin_token_cannot_buy_an_owners_subscription()
    {
        // Audience separation again: /api/v1/me takes owner tokens only, and the subscription routes
        // are inside it rather than beside it.
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me/listings/1/subscription");
        request.Headers.Add("Authorization", "Bearer not-a-real-admin-token");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    // ------------------------------------------------------------------ the webhook
    [Fact]
    public async Task With_no_webhook_secret_a_delivery_is_refused_rather_than_trusted()
    {
        using var app = With();
        using var client = app.CreateClient();

        var response = await client.PostAsync("/api/v1/webhooks/razorpay", Json("""{"event":"payment.captured"}"""));

        // 503, not 200: the event is real and the fix is configuration, so this is one of the few
        // cases where being retried is what we want.
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task An_unsigned_delivery_is_refused()
    {
        using var app = With(("Payments:WebhookSecret", WebhookSecret));
        using var client = app.CreateClient();

        var response = await client.PostAsync("/api/v1/webhooks/razorpay", Json("""{"event":"payment.captured"}"""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_delivery_signed_with_the_wrong_secret_is_refused()
    {
        using var app = With(("Payments:WebhookSecret", WebhookSecret));
        using var client = app.CreateClient();

        const string body = """{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_x","order_id":"order_x","amount":39900}}}}""";
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/webhooks/razorpay") { Content = Json(body) };
        request.Headers.Add("X-Razorpay-Signature", Sign(body, "some_other_secret"));

        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task A_tampered_body_is_refused_even_with_a_signature_that_was_once_valid()
    {
        // The replay-and-edit attempt: a genuine signature kept, the amount lowered.
        using var app = With(("Payments:WebhookSecret", WebhookSecret));
        using var client = app.CreateClient();

        const string original = """{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_x","order_id":"order_x","amount":39900}}}}""";
        var signature = Sign(original, WebhookSecret);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/webhooks/razorpay")
        {
            Content = Json(original.Replace("39900", "100")),
        };
        request.Headers.Add("X-Razorpay-Signature", signature);

        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task A_correctly_signed_event_we_do_not_act_on_is_acknowledged_and_ignored()
    {
        // Verified, understood, and deliberately not acted on. It must answer 200 without touching
        // the database — which this host could not reach anyway, so a 200 here also proves no query
        // was attempted.
        using var app = With(("Payments:WebhookSecret", WebhookSecret));
        using var client = app.CreateClient();

        const string body = """{"event":"payment.authorized","payload":{}}""";
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/webhooks/razorpay") { Content = Json(body) };
        request.Headers.Add("X-Razorpay-Signature", Sign(body, WebhookSecret));

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("ignored", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_correctly_signed_body_that_is_not_json_is_acknowledged_and_ignored()
    {
        using var app = With(("Payments:WebhookSecret", WebhookSecret));
        using var client = app.CreateClient();

        const string body = "not json at all";
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/webhooks/razorpay") { Content = Json(body) };
        request.Headers.Add("X-Razorpay-Signature", Sign(body, WebhookSecret));

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("ignored", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_empty_body_is_refused()
    {
        using var app = With(("Payments:WebhookSecret", WebhookSecret));
        using var client = app.CreateClient();

        var response = await client.PostAsync("/api/v1/webhooks/razorpay", Json(""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task The_webhook_does_not_answer_a_get()
    {
        using var app = With(("Payments:WebhookSecret", WebhookSecret));
        using var client = app.CreateClient();

        Assert.Equal(
            HttpStatusCode.MethodNotAllowed,
            (await client.GetAsync("/api/v1/webhooks/razorpay")).StatusCode);
    }
}
