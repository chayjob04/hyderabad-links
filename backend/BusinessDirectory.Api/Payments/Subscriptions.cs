using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Payments;

/// <summary>
/// The one place a listing becomes Verified.
///
/// Both ways in — the owner's browser returning from the checkout, and Razorpay's webhook — call
/// <see cref="RecordVerifiedPaymentAsync"/>, and neither reaches it until a signature has been
/// checked. There is no method here that marks a subscription paid without one, deliberately: that
/// is the whole protection against a listing being verified for nothing.
///
/// Everything happens in one transaction with the payment row locked, because the two callers can
/// arrive at the same moment — Razorpay's webhook routinely beats the browser back — and the second
/// one must find the work done rather than do it again. A replayed webhook, a refreshed success page
/// and a double-clicked "Pay" button all end at <see cref="PaymentOutcome.AlreadyApplied"/>, so none
/// of them grants a second year.
/// </summary>
public static class Subscriptions
{
    public enum PaymentOutcome
    {
        /// <summary>The period was granted: either a new one, or an extension of a live one.</summary>
        Activated,

        /// <summary>This payment had already been applied. Nothing changed, which is the point.</summary>
        AlreadyApplied,

        /// <summary>No order of ours has that id, so there is nothing to grant and no listing to grant it to.</summary>
        UnknownOrder,

        /// <summary>The provider reported a different amount from the order we opened. Never granted.</summary>
        AmountMismatch,
    }

    /// <param name="ExpiresAt">When the paid period now ends. Null unless something was granted or found.</param>
    public sealed record PaymentResult(
        PaymentOutcome Outcome,
        long? SubscriptionId = null,
        long? ListingId = null,
        string? PlanSlug = null,
        DateTimeOffset? ExpiresAt = null);

    /// <summary>
    /// Opens a payment attempt against an order the provider has already created. Status
    /// <c>created</c>: an attempt, not a payment. The unique index on
    /// (provider, provider_order_id) means a repeated order id cannot produce two attempts.
    /// </summary>
    public static async Task<long> CreateAttemptAsync(
        SqlConnection conn,
        long listingId,
        string provider,
        string orderId,
        long amountPaise,
        string currency,
        CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"INSERT INTO dbo.subscription_payments
                  (listing_id, provider, provider_order_id, amount_paise, currency, status)
              OUTPUT INSERTED.id
              VALUES (@listing, @provider, @order, @amount, @currency, 'created')", conn);
        command.Parameters.AddWithValue("listing", listingId);
        command.Parameters.AddWithValue("provider", provider);
        command.Parameters.AddWithValue("order", orderId);
        command.Parameters.AddWithValue("amount", amountPaise);
        command.Parameters.AddWithValue("currency", currency);

        return (long)(await command.ExecuteScalarAsync(ct))!;
    }

    /// <summary>
    /// Records a payment whose signature has already been verified, and grants the period it bought.
    /// </summary>
    /// <param name="ownerUserId">
    /// When given, the payment must belong to a listing this owner is a member of; anything else is
    /// reported as an unknown order. The browser-facing route passes it so that one owner cannot
    /// claim another's order; the webhook has no owner and passes null.
    /// </param>
    /// <param name="paidAmountPaise">
    /// What the provider says was actually paid, when it tells us (the webhook does; the checkout
    /// callback does not). A mismatch is refused outright — a part payment must not buy a full year.
    /// </param>
    /// <param name="webhookEventId">
    /// The provider's event id, when this came from a webhook. It is stored, and its unique index is
    /// what makes a redelivery of the same event harmless.
    /// </param>
    public static async Task<PaymentResult> RecordVerifiedPaymentAsync(
        SqlConnection conn,
        string provider,
        string orderId,
        string paymentId,
        int periodMonths,
        CancellationToken ct,
        long? ownerUserId = null,
        long? paidAmountPaise = null,
        string? webhookEventId = null)
    {
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        // The attempt row, locked for the rest of the transaction. The ownership join is part of the
        // lookup, so another owner's order simply is not found.
        var ownerJoin = ownerUserId is null
            ? ""
            : @" JOIN dbo.listings li ON li.id = p.listing_id
                 JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user";

        await using var find = new SqlCommand(
            @"SELECT p.id, p.listing_id, p.amount_paise, p.status, p.subscription_id
              FROM dbo.subscription_payments p WITH (UPDLOCK, ROWLOCK)" + ownerJoin + @"
              WHERE p.provider = @provider AND p.provider_order_id = @order", conn, tx);
        find.Parameters.AddWithValue("provider", provider);
        find.Parameters.AddWithValue("order", orderId);
        if (ownerUserId is not null)
        {
            find.Parameters.AddWithValue("user", ownerUserId.Value);
        }

        long attemptId;
        long listingId;
        long orderAmountPaise;
        string status;
        long? subscriptionId;

        await using (var reader = await find.ExecuteReaderAsync(ct))
        {
            if (!await reader.ReadAsync(ct))
            {
                await tx.RollbackAsync(ct);
                return new PaymentResult(PaymentOutcome.UnknownOrder);
            }

            attemptId = reader.GetInt64(0);
            listingId = reader.GetInt64(1);
            orderAmountPaise = reader.GetInt64(2);
            status = reader.GetString(3);
            subscriptionId = await reader.IsDBNullAsync(4, ct) ? null : reader.GetInt64(4);
        }

        if (status == "paid")
        {
            // Already applied. Reporting what is in force, rather than granting anything, is what
            // makes a replayed webhook and a refreshed success page both harmless.
            var current = await ReadPeriodAsync(conn, tx, subscriptionId, ct);
            await tx.CommitAsync(ct);
            return new PaymentResult(
                PaymentOutcome.AlreadyApplied, subscriptionId, listingId, current?.PlanSlug, current?.ExpiresAt);
        }

        if (paidAmountPaise is not null && paidAmountPaise.Value != orderAmountPaise)
        {
            /* The amount is the one part of a provider's message that changes what the customer
               gets, so it is checked against the order we opened rather than trusted. The row is
               left as it is and marked failed, so the attempt is visible and no period is granted. */
            await using var mismatch = new SqlCommand(
                @"UPDATE dbo.subscription_payments
                  SET status = 'failed', provider_payment_id = @payment, updated_at = SYSDATETIMEOFFSET()
                  WHERE id = @id", conn, tx);
            mismatch.Parameters.AddWithValue("payment", paymentId);
            mismatch.Parameters.AddWithValue("id", attemptId);
            await mismatch.ExecuteNonQueryAsync(ct);
            await tx.CommitAsync(ct);
            return new PaymentResult(PaymentOutcome.AmountMismatch, null, listingId);
        }

        var plan = await ReadPaidPlanSlugAsync(conn, tx, attemptId, ct);
        var granted = await GrantPeriodAsync(conn, tx, listingId, plan, periodMonths, ct);

        await using (var markPaid = new SqlCommand(
            @"UPDATE dbo.subscription_payments
              SET status = 'paid',
                  provider_payment_id = @payment,
                  subscription_id = @subscription,
                  signature_verified_at = SYSDATETIMEOFFSET(),
                  paid_at = SYSDATETIMEOFFSET(),
                  webhook_event_id = COALESCE(@event, webhook_event_id),
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            markPaid.Parameters.AddWithValue("payment", paymentId);
            markPaid.Parameters.AddWithValue("subscription", granted.SubscriptionId);
            markPaid.Parameters.AddWithValue("event", (object?)webhookEventId ?? DBNull.Value);
            markPaid.Parameters.AddWithValue("id", attemptId);
            await markPaid.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return new PaymentResult(
            PaymentOutcome.Activated, granted.SubscriptionId, listingId, plan, granted.ExpiresAt);
    }

    /// <summary>
    /// Whether this provider has already delivered this event. Checked before anything is locked, so
    /// a redelivery costs one indexed read. The unique index on (provider, webhook_event_id) is what
    /// actually guarantees it; this is the cheap path, not the guarantee.
    /// </summary>
    public static async Task<bool> WebhookEventAlreadySeenAsync(
        SqlConnection conn, string provider, string eventId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT TOP (1) 1 FROM dbo.subscription_payments
              WHERE provider = @provider AND webhook_event_id = @event", conn);
        command.Parameters.AddWithValue("provider", provider);
        command.Parameters.AddWithValue("event", eventId);

        return await command.ExecuteScalarAsync(ct) is not null;
    }

    private sealed record Period(long SubscriptionId, string PlanSlug, DateTimeOffset ExpiresAt);

    /// <summary>
    /// Grants the period: extends a live one, or opens a new one.
    ///
    /// A renewal extends from the existing <c>expires_at</c>, not from today, so an owner who renews
    /// a month early keeps that month. <c>subscriptions_one_active_idx</c> allows one active row per
    /// listing, which is why a lapsed row is closed off first — its status is still 'active' until
    /// something says otherwise, even though the entitlements view has read it as expired all along.
    /// </summary>
    private static async Task<Period> GrantPeriodAsync(
        SqlConnection conn, SqlTransaction tx, long listingId, string planSlug, int periodMonths, CancellationToken ct)
    {
        await using (var closeLapsed = new SqlCommand(
            @"UPDATE dbo.subscriptions
              SET status = 'expired', updated_at = SYSDATETIMEOFFSET()
              WHERE listing_id = @listing AND status = 'active' AND expires_at <= SYSDATETIMEOFFSET()", conn, tx))
        {
            closeLapsed.Parameters.AddWithValue("listing", listingId);
            await closeLapsed.ExecuteNonQueryAsync(ct);
        }

        long? liveId = null;
        await using (var live = new SqlCommand(
            @"SELECT TOP (1) id FROM dbo.subscriptions WITH (UPDLOCK, ROWLOCK)
              WHERE listing_id = @listing AND status = 'active' AND expires_at > SYSDATETIMEOFFSET()
              ORDER BY expires_at DESC", conn, tx))
        {
            live.Parameters.AddWithValue("listing", listingId);
            if (await live.ExecuteScalarAsync(ct) is long found)
            {
                liveId = found;
            }
        }

        Period period;
        if (liveId is not null)
        {
            await using var extend = new SqlCommand(
                @"UPDATE dbo.subscriptions
                  SET expires_at = DATEADD(month, @months, expires_at),
                      plan_slug = @plan,
                      updated_at = SYSDATETIMEOFFSET()
                  WHERE id = @id;
                  SELECT expires_at FROM dbo.subscriptions WHERE id = @id;", conn, tx);
            extend.Parameters.AddWithValue("months", periodMonths);
            extend.Parameters.AddWithValue("plan", planSlug);
            extend.Parameters.AddWithValue("id", liveId.Value);

            var expires = (DateTimeOffset)(await extend.ExecuteScalarAsync(ct))!;
            period = new Period(liveId.Value, planSlug, expires);
        }
        else
        {
            await using var insert = new SqlCommand(
                @"INSERT INTO dbo.subscriptions (listing_id, plan_slug, status, starts_at, expires_at)
                  OUTPUT INSERTED.id, INSERTED.expires_at
                  VALUES (@listing, @plan, 'active', SYSDATETIMEOFFSET(),
                          DATEADD(month, @months, SYSDATETIMEOFFSET()))", conn, tx);
            insert.Parameters.AddWithValue("listing", listingId);
            insert.Parameters.AddWithValue("plan", planSlug);
            insert.Parameters.AddWithValue("months", periodMonths);

            await using var reader = await insert.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            period = new Period(reader.GetInt64(0), planSlug, reader.GetDateTimeOffset(1));
        }

        /* What the listing has bought, kept on the listing itself so the entitlements view can show
           an owner "your Verified plan ended on the 3rd" rather than silently dropping them to Free
           with no explanation. It is never what grants anything: every allowance is read from the
           view, which looks at the subscription period and the clock. */
        await using (var remember = new SqlCommand(
            @"UPDATE dbo.listings
              SET plan_slug = @plan, updated_at = SYSDATETIMEOFFSET()
              WHERE id = @listing AND plan_slug <> @plan", conn, tx))
        {
            remember.Parameters.AddWithValue("plan", planSlug);
            remember.Parameters.AddWithValue("listing", listingId);
            await remember.ExecuteNonQueryAsync(ct);
        }

        return period;
    }

    /// <summary>
    /// Which plan this attempt was opened for. Read from the attempt's own amount against the plans
    /// table, so a price change between opening the order and paying it cannot quietly grant a
    /// different tier: the only paid plan is matched by the amount that was actually charged.
    /// </summary>
    private static async Task<string> ReadPaidPlanSlugAsync(
        SqlConnection conn, SqlTransaction tx, long attemptId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT TOP (1) pl.slug
              FROM dbo.subscription_payments p
              JOIN dbo.plans pl ON pl.price_paise = p.amount_paise
                               AND pl.grants_verified_badge = 1
                               AND pl.is_active = 1
              WHERE p.id = @id
              ORDER BY pl.sort_order", conn, tx);
        command.Parameters.AddWithValue("id", attemptId);

        // Falling back to the configured paid plan rather than throwing: the amount came from the
        // plans table when the order was opened, so the only way here is a price edited in between.
        return await command.ExecuteScalarAsync(ct) as string ?? "verified";
    }

    private static async Task<Period?> ReadPeriodAsync(
        SqlConnection conn, SqlTransaction tx, long? subscriptionId, CancellationToken ct)
    {
        if (subscriptionId is null)
        {
            return null;
        }

        await using var command = new SqlCommand(
            "SELECT plan_slug, expires_at FROM dbo.subscriptions WHERE id = @id", conn, tx);
        command.Parameters.AddWithValue("id", subscriptionId.Value);

        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct)
            ? new Period(subscriptionId.Value, reader.GetString(0), reader.GetDateTimeOffset(1))
            : null;
    }
}
