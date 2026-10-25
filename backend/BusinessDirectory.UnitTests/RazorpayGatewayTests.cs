using System.Net;
using System.Text;
using System.Text.Json;
using BusinessDirectory.Api.Payments;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace BusinessDirectory.UnitTests;

// Razorpay has never been sent a real order from this project. What can be established without an
// account is the part that is ours: that the request carries the amount in paise as Razorpay's API
// expects, that the keys travel as HTTP basic auth, and that a refusal throws with the reason rather
// than being swallowed into a half-recorded payment.
//
// Every key below is an obvious test string and none has ever authenticated anything.
public class RazorpayGatewayTests
{
    private const string KeyId = "rzp_test_key_id";
    private const string KeySecret = "test_secret_not_a_real_key";

    private static PaymentSettings Settings() =>
        PaymentSettings.Load(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Payments:Provider"] = "razorpay",
            ["Payments:KeyId"] = KeyId,
            ["Payments:KeySecret"] = KeySecret,
        }).Build());

    /// <summary>Captures the one request instead of sending it, and answers with whatever the test wants.</summary>
    private sealed class CapturingHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? RequestBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent(body) };
        }
    }

    private static (RazorpayGateway Gateway, CapturingHandler Handler) Build(
        HttpStatusCode status = HttpStatusCode.OK,
        string body = """{"id":"order_TESTONLY00001","amount":39900,"currency":"INR"}""")
    {
        var handler = new CapturingHandler(status, body);
        return (new RazorpayGateway(new HttpClient(handler), Settings(), NullLogger<RazorpayGateway>.Instance), handler);
    }

    private static Task<PaymentOrder> CreateOrder(RazorpayGateway gateway) =>
        gateway.CreateOrderAsync(
            39900, "INR", "listing-82-20261025120000",
            new Dictionary<string, string> { ["listing_id"] = "82", ["plan"] = "verified" },
            CancellationToken.None);

    [Fact]
    public async Task The_order_goes_to_razorpays_orders_endpoint_with_the_amount_in_paise()
    {
        var (gateway, handler) = Build();

        await CreateOrder(gateway);

        Assert.Equal(HttpMethod.Post, handler.Request!.Method);
        Assert.Equal("https://api.razorpay.com/v1/orders", handler.Request.RequestUri!.ToString());

        // Paise, not rupees. Sending 399 here would charge Rs 3.99 and the mistake would look like
        // a working integration.
        using var sent = JsonDocument.Parse(handler.RequestBody!);
        Assert.Equal(39900, sent.RootElement.GetProperty("amount").GetInt64());
        Assert.Equal("INR", sent.RootElement.GetProperty("currency").GetString());
        Assert.Equal("listing-82-20261025120000", sent.RootElement.GetProperty("receipt").GetString());
        Assert.Equal("82", sent.RootElement.GetProperty("notes").GetProperty("listing_id").GetString());
    }

    [Fact]
    public async Task The_keys_travel_as_basic_auth_and_not_in_the_body()
    {
        var (gateway, handler) = Build();

        await CreateOrder(gateway);

        var authorization = handler.Request!.Headers.Authorization;
        Assert.Equal("Basic", authorization!.Scheme);
        Assert.Equal(
            $"{KeyId}:{KeySecret}",
            Encoding.UTF8.GetString(Convert.FromBase64String(authorization.Parameter!)));

        // The secret belongs in the header alone. A copy in the body would end up in any log that
        // records request payloads.
        Assert.DoesNotContain(KeySecret, handler.RequestBody!);
    }

    [Fact]
    public async Task The_providers_own_order_id_is_what_comes_back()
    {
        // This id is what the signature is later verified against, so taking it from the response
        // rather than making one up locally is the whole point of this call.
        var (gateway, _) = Build();

        var order = await CreateOrder(gateway);

        Assert.Equal("order_TESTONLY00001", order.Id);
        Assert.Equal(39900, order.AmountPaise);
        Assert.Equal("INR", order.Currency);
    }

    [Fact]
    public async Task A_refusal_throws_with_the_reason_and_never_the_key()
    {
        var (gateway, _) = Build(
            HttpStatusCode.BadRequest,
            """{"error":{"code":"BAD_REQUEST_ERROR","description":"The amount must be atleast INR 1.00"}}""");

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(() => CreateOrder(gateway));

        Assert.Contains("400", failure.Message);
        Assert.Contains("atleast INR 1.00", failure.Message);
        Assert.DoesNotContain(KeySecret, failure.Message);
    }

    [Fact]
    public async Task An_accepted_order_with_no_id_is_a_failure_rather_than_a_payment_nothing_can_verify()
    {
        // A 200 with no order id would otherwise be recorded as an attempt whose signature could
        // never be checked, which is the one state worth refusing outright.
        var (gateway, _) = Build(HttpStatusCode.OK, """{"amount":39900}""");

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(() => CreateOrder(gateway));

        Assert.Contains("no order id", failure.Message);
    }

    [Fact]
    public async Task A_huge_error_page_is_truncated_rather_than_logged_whole()
    {
        var (gateway, _) = Build(HttpStatusCode.BadGateway, new string('x', 5_000));

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(() => CreateOrder(gateway));

        Assert.True(failure.Message.Length < 700, $"The message was {failure.Message.Length} characters long.");
    }
}
