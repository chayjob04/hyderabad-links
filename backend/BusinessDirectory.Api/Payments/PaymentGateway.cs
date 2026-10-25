using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Serialization;

namespace BusinessDirectory.Api.Payments;

/// <summary>
/// Creating the order a checkout is opened against. One interface, so the endpoints never know which
/// provider is in use: the difference is configuration.
/// </summary>
public interface IPaymentGateway
{
    /// <summary>False when no provider is configured. Endpoints answer 503 rather than recording a
    /// payment attempt that no provider has ever heard of.</summary>
    bool IsConfigured { get; }

    /// <summary>The key the checkout script needs in the browser. Null when unconfigured.</summary>
    string? PublishableKeyId { get; }

    /// <summary>Opens an order at the provider. Throws on any non-success answer.</summary>
    Task<PaymentOrder> CreateOrderAsync(
        long amountPaise, string currency, string receipt, IReadOnlyDictionary<string, string> notes,
        CancellationToken cancellationToken);
}

/// <param name="Id">The provider's own order id, which is what the signature is later checked against.</param>
public sealed record PaymentOrder(string Id, long AmountPaise, string Currency);

/// <summary>
/// Razorpay's Orders API.
///
/// **This has never created a real order.** It is written against Razorpay's documented
/// <c>POST /v1/orders</c> contract so that it works the moment the keys are set, and nothing in this
/// project claims payments work until a real payment has been taken and the subscription it bought
/// has been seen in the database.
///
/// No SDK: one authenticated POST does not justify a dependency, and <c>AddHttpClient</c> already
/// gives the pooling and timeouts an SDK would bring.
/// </summary>
public sealed class RazorpayGateway(
    HttpClient client,
    PaymentSettings settings,
    ILogger<RazorpayGateway> logger) : IPaymentGateway
{
    private const string OrdersEndpoint = "https://api.razorpay.com/v1/orders";

    public bool IsConfigured => settings.IsConfigured;

    public string? PublishableKeyId => settings.IsConfigured ? settings.KeyId : null;

    public async Task<PaymentOrder> CreateOrderAsync(
        long amountPaise, string currency, string receipt, IReadOnlyDictionary<string, string> notes,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException(
                "Razorpay is selected but Payments:KeyId and/or Payments:KeySecret are not configured.");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, OrdersEndpoint)
        {
            Content = JsonContent.Create(new OrderRequest(amountPaise, currency, receipt, notes)),
        };

        // Basic auth over key_id:key_secret, which is how Razorpay authenticates server calls.
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.KeyId}:{settings.KeySecret}")));

        using var response = await client.SendAsync(request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            // Razorpay explains refusals (a currency it will not take, an amount below the minimum)
            // in the body. Capped, so an unexpected HTML error page is not a megabyte of log, and
            // the key never appears in it.
            var body = await ReadShortBody(response, cancellationToken);
            throw new InvalidOperationException(
                $"Razorpay refused the order ({(int)response.StatusCode} {response.ReasonPhrase}). {body}".TrimEnd());
        }

        var created = await response.Content.ReadFromJsonAsync<OrderResponse>(cancellationToken);
        if (created is null || string.IsNullOrWhiteSpace(created.Id))
        {
            throw new InvalidOperationException("Razorpay accepted the order but returned no order id.");
        }

        logger.LogInformation(
            "Razorpay order created. Order: {OrderId} | amount: {AmountPaise} paise", created.Id, created.Amount);

        return new PaymentOrder(created.Id, created.Amount, created.Currency ?? currency);
    }

    private static async Task<string> ReadShortBody(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            return body.Length > 500 ? body[..500] : body;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return string.Empty;
        }
    }

    /// <summary>Razorpay's documented field names, which are snake_case.</summary>
    private sealed record OrderRequest(
        [property: JsonPropertyName("amount")] long Amount,
        [property: JsonPropertyName("currency")] string Currency,
        [property: JsonPropertyName("receipt")] string Receipt,
        [property: JsonPropertyName("notes")] IReadOnlyDictionary<string, string> Notes);

    private sealed record OrderResponse(
        [property: JsonPropertyName("id")] string? Id,
        [property: JsonPropertyName("amount")] long Amount,
        [property: JsonPropertyName("currency")] string? Currency);
}

/// <summary>
/// What is registered when no provider is configured. Reporting "not configured" is the point: the
/// endpoints check it and answer 503, so nothing records an order that does not exist, and nobody is
/// ever shown a checkout that cannot be verified.
/// </summary>
public sealed class UnconfiguredPaymentGateway : IPaymentGateway
{
    public bool IsConfigured => false;

    public string? PublishableKeyId => null;

    public Task<PaymentOrder> CreateOrderAsync(
        long amountPaise, string currency, string receipt, IReadOnlyDictionary<string, string> notes,
        CancellationToken cancellationToken) =>
        throw new InvalidOperationException("No payment provider is configured (Payments:Provider).");
}
