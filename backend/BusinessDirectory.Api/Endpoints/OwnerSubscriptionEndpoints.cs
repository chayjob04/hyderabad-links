using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Payments;
using Microsoft.Data.SqlClient;
using System.Security.Claims;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Buying and renewing the Verified plan, under /api/v1/me/listings/{id}/subscription.
///
/// Three routes, and the order matters: <c>GET</c> says what this listing has and what the paid plan
/// costs, <c>POST /order</c> opens an order at the provider, and <c>POST /verify</c> takes the
/// signed result back from the checkout. Nothing here can make a listing Verified without a
/// signature that matches Razorpay's own — <see cref="Subscriptions"/> has no method that grants a
/// period any other way.
///
/// With no provider configured every paying route answers **503** and writes nothing. That is the
/// honest answer: the alternative is a checkout nobody can verify, which ends with a customer
/// charged and no subscription, or a subscription granted for a payment that never happened.
///
/// The price is read from the <c>plans</c> table on each request, never from configuration or from a
/// constant, so a price change is an UPDATE and the amount the customer is charged is always the
/// amount the plan says.
/// </summary>
public static class OwnerSubscriptionEndpoints
{
    /// <param name="PlanSlug">What the listing is entitled to right now — 'free' once a period lapses.</param>
    /// <param name="PaidUntil">When the current period ends, or null when there is none.</param>
    /// <param name="SubscribedPlanSlug">What was last bought, which outlives the period that bought it.</param>
    /// <param name="PaymentsAvailable">
    /// False when no provider is configured. The website shows the plan and its price either way,
    /// and only hides the pay button, so an owner is never sent into a checkout that cannot complete.
    /// </param>
    public sealed record SubscriptionDto(
        string PlanSlug,
        string PlanName,
        bool Verified,
        DateTimeOffset? PaidUntil,
        string SubscribedPlanSlug,
        PaidPlanDto? PaidPlan,
        bool PaymentsAvailable);

    public sealed record PaidPlanDto(
        string Slug, string Name, long PricePaise, int PhotoLimit, int VideoLimit, int LinkLimit, int PeriodMonths);

    /// <param name="KeyId">Razorpay's publishable key, which the checkout script needs in the browser.</param>
    public sealed record OrderDto(
        string OrderId, long AmountPaise, string Currency, string KeyId, string PlanName, string BusinessName);

    public sealed record VerifyRequest(string? RazorpayOrderId, string? RazorpayPaymentId, string? RazorpaySignature);

    public sealed record VerifyResultDto(string PlanSlug, DateTimeOffset? PaidUntil, bool AlreadyApplied);

    public static RouteGroupBuilder MapOwnerSubscriptionEndpoints(this RouteGroupBuilder listings)
    {
        var group = listings.MapGroup("/{id:long}/subscription");
        group.MapGet("", Get);
        group.MapPost("/order", CreateOrder);
        group.MapPost("/verify", Verify);
        return listings;
    }

    private static async Task<IResult> Get(
        long id,
        ClaimsPrincipal principal,
        SqlDatabase db,
        PaymentSettings payments,
        IPaymentGateway gateway,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);

        var state = await ReadEntitlement(conn, null, userId, id, ct);
        if (state is null)
        {
            return Results.NotFound();
        }

        var paidPlan = await ReadPaidPlan(conn, null, payments.PlanSlug, payments.PeriodMonths, ct);

        return Results.Ok(new SubscriptionDto(
            state.PlanSlug,
            state.PlanName,
            state.Verified,
            state.PaidUntil,
            state.SubscribedPlanSlug,
            paidPlan,
            gateway.IsConfigured));
    }

    private static async Task<IResult> CreateOrder(
        long id,
        ClaimsPrincipal principal,
        SqlDatabase db,
        PaymentSettings payments,
        IPaymentGateway gateway,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        if (!gateway.IsConfigured)
        {
            return Results.Problem(
                "Online payment is not available yet. Nothing has been charged.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        await using var conn = await db.OpenConnectionAsync(ct);

        var state = await ReadEntitlement(conn, null, userId, id, ct);
        if (state is null)
        {
            return Results.NotFound();
        }

        var paidPlan = await ReadPaidPlan(conn, null, payments.PlanSlug, payments.PeriodMonths, ct);
        if (paidPlan is null)
        {
            // The configured plan is not an active paid plan. Refusing beats charging for a tier
            // that grants nothing.
            logger.LogError("Payments:PlanSlug '{Plan}' is not an active paid plan.", payments.PlanSlug);
            return Results.Problem(
                "Online payment is not available yet. Nothing has been charged.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        // A draft or rejected listing has no public page, so there is nothing for a badge to appear
        // on. Taking the money first and leaving the owner to wonder where it went is worse than
        // asking them to get the listing live.
        if (state.Status is not ("active" or "pending_review" or "suspended"))
        {
            return Results.Problem(
                "Submit this listing and get it published first. Nothing has been charged.",
                statusCode: StatusCodes.Status409Conflict);
        }

        PaymentOrder order;
        try
        {
            order = await gateway.CreateOrderAsync(
                paidPlan.PricePaise,
                "INR",
                // The receipt is what ties a provider dashboard row back to a listing. No personal
                // data in it: Razorpay's dashboard is a third party.
                $"listing-{id}-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}",
                new Dictionary<string, string> { ["listing_id"] = id.ToString(), ["plan"] = paidPlan.Slug },
                ct);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            // Never the provider's message to the customer: it can carry account detail. The log
            // keeps it, and the log never carries the key (RazorpayGateway caps and quotes only the body).
            logger.LogError(ex, "Could not open a payment order for listing {ListingId}.", id);
            return Results.Problem(
                "We could not start the payment. Nothing has been charged. Please try again.",
                statusCode: StatusCodes.Status502BadGateway);
        }

        await Subscriptions.CreateAttemptAsync(conn, id, "razorpay", order.Id, order.AmountPaise, order.Currency, ct);

        return Results.Ok(new OrderDto(
            order.Id, order.AmountPaise, order.Currency, gateway.PublishableKeyId!, paidPlan.Name, state.BusinessName));
    }

    private static async Task<IResult> Verify(
        long id,
        VerifyRequest body,
        ClaimsPrincipal principal,
        SqlDatabase db,
        PaymentSettings payments,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        if (!payments.IsConfigured)
        {
            return Results.Problem(
                "Online payment is not available yet.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        if (!RazorpaySignature.IsValidCheckout(
                body.RazorpayOrderId, body.RazorpayPaymentId, body.RazorpaySignature, payments.KeySecret))
        {
            /* The only outcome for an unverified result is refusal. Logged without the signature or
               the key, because an attacker's guess is not worth storing and a secret must not be. */
            logger.LogWarning(
                "A payment result for listing {ListingId} did not verify and was refused.", id);
            return Results.Problem(
                "We could not confirm that payment. If you were charged, nothing is lost — contact us and we will sort it out.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        await using var conn = await db.OpenConnectionAsync(ct);

        var result = await Subscriptions.RecordVerifiedPaymentAsync(
            conn,
            "razorpay",
            body.RazorpayOrderId!,
            body.RazorpayPaymentId!,
            payments.PeriodMonths,
            ct,
            ownerUserId: userId);

        switch (result.Outcome)
        {
            case Subscriptions.PaymentOutcome.UnknownOrder:
                // Either not ours or not this owner's. 404 rather than 403, like every other owner
                // route, so a prober learns nothing about which orders exist.
                return Results.NotFound();

            case Subscriptions.PaymentOutcome.AmountMismatch:
                logger.LogError("A verified payment for listing {ListingId} carried the wrong amount.", id);
                return Results.Problem(
                    "That payment does not match the order. Nothing has been changed; please contact us.",
                    statusCode: StatusCodes.Status409Conflict);

            default:
                if (result.ListingId != id)
                {
                    // The order belongs to a different listing of this owner's. Applying it to the
                    // one in the URL would verify the wrong business.
                    return Results.NotFound();
                }

                return Results.Ok(new VerifyResultDto(
                    result.PlanSlug ?? payments.PlanSlug,
                    result.ExpiresAt,
                    result.Outcome == Subscriptions.PaymentOutcome.AlreadyApplied));
        }
    }

    private sealed record EntitlementState(
        string PlanSlug,
        string PlanName,
        bool Verified,
        DateTimeOffset? PaidUntil,
        string SubscribedPlanSlug,
        string Status,
        string BusinessName);

    /// <summary>
    /// What this listing is entitled to right now, or null when it is not this owner's listing.
    /// Straight from <c>listing_entitlements</c>, so this screen and the allowance the API actually
    /// enforces can never disagree.
    /// </summary>
    private static async Task<EntitlementState?> ReadEntitlement(
        SqlConnection conn, SqlTransaction? tx, long userId, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT e.effective_plan_slug, e.effective_plan_name, e.is_verified, e.paid_until,
                     e.subscribed_plan_slug, li.status, b.name
              FROM dbo.listings li
              JOIN dbo.businesses b ON b.id = li.business_id
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              JOIN dbo.listing_entitlements e ON e.listing_id = li.id
              WHERE li.id = @listing AND li.status <> 'archived'", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("listing", listingId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new EntitlementState(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetBoolean(2),
            await reader.IsDBNullAsync(3, ct) ? null : reader.GetDateTimeOffset(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.GetString(6));
    }

    /// <summary>
    /// The paid plan as the database has it. Null when the configured slug is not an active plan that
    /// grants verification, which is a misconfiguration and not something to charge for.
    /// </summary>
    private static async Task<PaidPlanDto?> ReadPaidPlan(
        SqlConnection conn, SqlTransaction? tx, string planSlug, int periodMonths, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT slug, name, price_paise, photo_limit, video_limit
              FROM dbo.plans
              WHERE slug = @slug AND is_active = 1 AND grants_verified_badge = 1 AND price_paise > 0", conn, tx);
        command.Parameters.AddWithValue("slug", planSlug);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new PaidPlanDto(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetInt64(2),
            reader.GetInt32(3),
            reader.GetInt32(4),
            // The link allowance is the view's own CASE, which is 5 for a plan that verifies.
            LinkLimit: 5,
            PeriodMonths: periodMonths);
    }
}
