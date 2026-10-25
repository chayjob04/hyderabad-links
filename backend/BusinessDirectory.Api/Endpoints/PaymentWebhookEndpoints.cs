using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Payments;
using System.Text.Json;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Razorpay's webhook, at /api/v1/webhooks/razorpay.
///
/// This exists because the browser is not a reliable messenger. A customer who pays and then closes
/// the tab, loses signal, or is bounced by a bank's 3-D Secure page never returns to
/// <c>/subscription/verify</c>, and without this endpoint their money would be taken and their
/// listing would stay Free. The webhook is the path that does not depend on anyone's browser.
///
/// It is also the one endpoint here that anybody on the internet can reach, so it trusts nothing:
///   * the raw body is verified against <c>X-Razorpay-Signature</c> before anything looks inside it,
///     and an unsigned or wrongly signed delivery is refused without touching the database;
///   * the amount in the message is checked against the order we opened, in
///     <see cref="Subscriptions.RecordVerifiedPaymentAsync"/>, so a replayed-and-edited body cannot
///     buy a year for one rupee;
///   * the provider's event id is stored under a unique index, so a redelivery — which Razorpay does
///     routinely, and does whenever we answer anything but 2xx — grants nothing a second time.
///
/// Anything understood, already done, or deliberately ignored answers **200**: a non-2xx tells
/// Razorpay to deliver again, and asking to be retried over an event we will never act on is how a
/// webhook endpoint ends up processing the same delivery for days.
/// </summary>
public static class PaymentWebhookEndpoints
{
    /// <summary>Razorpay's cap is well under this; the limit is here so a flood cannot be used to fill memory.</summary>
    private const int MaxBodyBytes = 64 * 1024;

    public static IEndpointRouteBuilder MapPaymentWebhookEndpoints(this IEndpointRouteBuilder app)
    {
        // No authorization: the signature *is* the authentication. There is no token a provider
        // could hold, and a shared bearer token in a dashboard would be weaker than an HMAC over
        // the body, which also proves the body was not edited in transit.
        app.MapPost("/api/v1/webhooks/razorpay", Razorpay);
        return app;
    }

    private static async Task<IResult> Razorpay(
        HttpRequest request,
        SqlDatabase db,
        PaymentSettings settings,
        Notifications.Notifier notifier,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        if (!settings.WebhooksConfigured)
        {
            // Nothing can be verified, so nothing is accepted. 503 and not 200: this one *should*
            // be retried, because the fix is configuration and the event is real.
            logger.LogWarning("A Razorpay webhook arrived but Payments:WebhookSecret is not configured.");
            return Results.Problem("Webhooks are not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var rawBody = await ReadBody(request, ct);
        if (rawBody is null)
        {
            return Results.Problem("The webhook body is empty or too large.", statusCode: StatusCodes.Status400BadRequest);
        }

        var signature = request.Headers["X-Razorpay-Signature"].ToString();
        if (!RazorpaySignature.IsValidWebhook(rawBody, signature, settings.WebhookSecret))
        {
            // Not logged with the body or the signature: an unverified body is attacker-controlled
            // and does not belong in a log that someone will later read as a record of real events.
            logger.LogWarning("A Razorpay webhook failed signature verification and was refused.");
            return Results.Problem("Signature verification failed.", statusCode: StatusCodes.Status400BadRequest);
        }

        Delivery? delivery;
        try
        {
            delivery = Parse(rawBody);
        }
        catch (JsonException)
        {
            // Signed by Razorpay but not a shape this code knows. 200, because retrying will
            // produce the same body.
            logger.LogWarning("A verified Razorpay webhook could not be parsed and was ignored.");
            return Results.Ok(new { status = "ignored" });
        }

        if (delivery is null)
        {
            // A verified event we do not act on — a refund, a subscription event, a payment that
            // merely authorised. Acknowledged so it is not redelivered.
            return Results.Ok(new { status = "ignored" });
        }

        // The event id comes from the header rather than the body, because that is where Razorpay
        // puts it. Without one, idempotency falls back to the order's own status, which the
        // transaction checks anyway.
        var eventId = request.Headers["X-Razorpay-Event-Id"].ToString();
        eventId = string.IsNullOrWhiteSpace(eventId) ? null : eventId;

        await using var conn = await db.OpenConnectionAsync(ct);

        if (eventId is not null && await Subscriptions.WebhookEventAlreadySeenAsync(conn, "razorpay", eventId, ct))
        {
            return Results.Ok(new { status = "already_applied" });
        }

        var result = await Subscriptions.RecordVerifiedPaymentAsync(
            conn,
            "razorpay",
            delivery.OrderId,
            delivery.PaymentId,
            settings.PeriodMonths,
            ct,
            paidAmountPaise: delivery.AmountPaise,
            webhookEventId: eventId);

        switch (result.Outcome)
        {
            case Subscriptions.PaymentOutcome.UnknownOrder:
                /* A real payment at Razorpay for an order this database has never heard of. Not an
                   error to retry — the order row is created before the checkout opens, so the only
                   ways here are a webhook from a different environment sharing one Razorpay account,
                   or a payment made outside this application. Logged loudly, because it means
                   somebody may have paid and got nothing. */
                logger.LogError(
                    "Razorpay reported a captured payment for order {OrderId}, which this database has no record of.",
                    delivery.OrderId);
                return Results.Ok(new { status = "unknown_order" });

            case Subscriptions.PaymentOutcome.AmountMismatch:
                logger.LogError(
                    "Razorpay reported {Paid} paise for order {OrderId}, which is not the amount that order was opened for. "
                    + "No subscription was granted.",
                    delivery.AmountPaise, delivery.OrderId);
                return Results.Ok(new { status = "amount_mismatch" });

            case Subscriptions.PaymentOutcome.AlreadyApplied:
                return Results.Ok(new { status = "already_applied" });

            default:
                logger.LogInformation(
                    "Listing {ListingId} is Verified until {ExpiresAt:u} after a payment confirmed by webhook.",
                    result.ListingId, result.ExpiresAt);

                // The receipt. This is the path that matters for it: a customer who closed the tab
                // never comes back to the success page, so without this they would hear nothing.
                await SubscriptionNotifications.SendActivatedAsync(conn, notifier, result, logger, ct);
                return Results.Ok(new { status = "applied" });
        }
    }

    /// <summary>The bytes exactly as they arrived, which is what the signature covers.</summary>
    private static async Task<string?> ReadBody(HttpRequest request, CancellationToken ct)
    {
        if (request.ContentLength > MaxBodyBytes)
        {
            return null;
        }

        using var reader = new StreamReader(request.Body);
        var body = await reader.ReadToEndAsync(ct);
        return string.IsNullOrWhiteSpace(body) || body.Length > MaxBodyBytes ? null : body;
    }

    private sealed record Delivery(string OrderId, string PaymentId, long AmountPaise);

    /// <summary>
    /// The two events that mean "this order is paid for", and nothing else.
    ///
    /// <c>payment.captured</c> is the one that matters: Razorpay settles money on capture, and a
    /// payment that was only authorised can still fail. <c>order.paid</c> carries the same payment
    /// entity and is accepted for the account configured to send that instead. Returns null for any
    /// other event, which the caller acknowledges and ignores.
    /// </summary>
    private static Delivery? Parse(string rawBody)
    {
        using var document = JsonDocument.Parse(rawBody);
        var root = document.RootElement;

        if (!root.TryGetProperty("event", out var eventName)
            || eventName.ValueKind != JsonValueKind.String
            || eventName.GetString() is not ("payment.captured" or "order.paid"))
        {
            return null;
        }

        if (!root.TryGetProperty("payload", out var payload)
            || !payload.TryGetProperty("payment", out var payment)
            || !payment.TryGetProperty("entity", out var entity))
        {
            return null;
        }

        var paymentId = entity.TryGetProperty("id", out var id) ? id.GetString() : null;
        var orderId = entity.TryGetProperty("order_id", out var order) ? order.GetString() : null;
        var amount = entity.TryGetProperty("amount", out var paise) && paise.ValueKind == JsonValueKind.Number
            ? paise.GetInt64()
            : 0L;

        if (string.IsNullOrWhiteSpace(paymentId) || string.IsNullOrWhiteSpace(orderId) || amount <= 0)
        {
            return null;
        }

        return new Delivery(orderId, paymentId, amount);
    }
}
