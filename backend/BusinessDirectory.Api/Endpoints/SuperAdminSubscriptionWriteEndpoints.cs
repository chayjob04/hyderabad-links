using System.Data;
using System.Globalization;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Granting, extending, moving and revoking a subscription by hand — under
/// /api/v1/super-admin/subscriptions (S0033).
///
/// Everything here is money-adjacent, so the boundaries are drawn first and they are not
/// negotiable by a request parameter:
///
/// <list type="bullet">
/// <item><b>No payment record is ever written, changed or deleted.</b> <c>subscription_payments</c>
/// is the record of money taken and nothing in this file touches it. A granted period is a
/// subscription with no payment behind it, and the <c>source</c> column says exactly that.</item>
/// <item><b>Nothing is marked as paid.</b> A grant is `complimentary` and carries the admin and the
/// reason; the table's own CHECK refuses the alternative.</item>
/// <item><b>A paid period cannot be revoked here.</b> Taking away something a business bought is a
/// refund, and refunds are a Razorpay operation that this project deliberately does not perform.
/// The refusal says so rather than pretending the button is missing.</item>
/// <item><b>Every action carries a reason</b> and lands in the audit log with the state before and
/// the state after, because "why is this listing Verified?" is a question somebody will ask months
/// later about a row that no longer looks unusual.</item>
/// </list>
///
/// <b>Entitlements need no syncing.</b> <c>dbo.listing_entitlements</c> decides what a listing may do
/// from "is there an active subscription whose period covers now", so a granted period grants
/// exactly what a paid one of the same plan grants, from the instant it is written. That is why this
/// is a few columns on <c>subscriptions</c> rather than a parallel notion of entitlement.
/// </summary>
public static class SuperAdminSubscriptionWriteEndpoints
{
    /// <summary>A subscription nobody paid for, granted by a named admin for a stated reason.</summary>
    public const string ComplimentarySource = "complimentary";

    /// <summary>A subscription a payment created. Written only by the webhook, never here.</summary>
    public const string PaymentSource = "payment";

    /// <summary>
    /// The longest period that can be granted or added in one go.
    /// </summary>
    /// <remarks>
    /// Two years. Not a technical limit: a typo in a months field is the likeliest mistake on this
    /// screen, and "240" granting twenty years of a paid plan is the kind of thing nobody notices
    /// until renewal season. Anything longer is a conversation, not a form.
    /// </remarks>
    public const int MaxMonths = 24;

    /// <param name="Months">How long, from now. 1 to <see cref="MaxMonths"/>.</param>
    /// <param name="Reason">Why. Required, stored on the subscription, and read beside it.</param>
    public sealed record GrantRequest(string? PlanSlug, int? Months, string? Reason);

    /// <param name="Months">How much longer, added to what is left. 1 to <see cref="MaxMonths"/>.</param>
    public sealed record ExtendRequest(int? Months, string? Reason);

    public sealed record ChangePlanRequest(string? PlanSlug, string? Reason);

    public sealed record RevokeRequest(string? Reason);

    /// <param name="Source">`payment` or `complimentary`: how this period came about.</param>
    public sealed record SubscriptionActionResultDto(
        long ListingId,
        long SubscriptionId,
        string PlanSlug,
        string Source,
        DateTimeOffset StartsAt,
        DateTimeOffset ExpiresAt,
        string Status);

    public static RouteGroupBuilder MapSuperAdminSubscriptionWriteEndpoints(this RouteGroupBuilder group)
    {
        var subscriptions = group.MapGroup("/subscriptions");
        subscriptions.MapPost("/{listingId:long}/grant", Grant);
        subscriptions.MapPost("/{listingId:long}/extend", Extend);
        subscriptions.MapPost("/{listingId:long}/plan", ChangePlan);
        subscriptions.MapPost("/{listingId:long}/revoke", Revoke);
        return group;
    }

    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return (null, Results.Unauthorized());
        }
        /* The same permission the read-only report is behind, and one only the platform owner's role
           holds. Giving away a paid plan is not moderation work. */
        return (admin, AdminAccess.AuthorizeSuper(admin, AdminPermissions.PlansManage));
    }

    private static IResult? BadReason(string? reason, out string cleaned)
    {
        cleaned = (reason ?? string.Empty).Trim();
        if (cleaned.Length < 3)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["reason"] = ["Say why. This is stored with the subscription and read months later."],
            });
        }
        if (cleaned.Length > 1000)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["reason"] = ["Keep it under 1000 characters."],
            });
        }
        return null;
    }

    private static IResult? BadMonths(int? months, out int cleaned)
    {
        cleaned = months ?? 0;
        if (cleaned < 1 || cleaned > MaxMonths)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["months"] = [$"Choose between 1 and {MaxMonths} months."],
            });
        }
        return null;
    }

    /// <summary>The listing, and what it has in force right now. Locked for the transaction.</summary>
    private static async Task<(string Name, long? SubscriptionId, string? PlanSlug, string? Source,
        DateTimeOffset? ExpiresAt)?> LockListing(
        SqlConnection conn, SqlTransaction tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            /* The listing row is locked, not the subscription: two admins acting on the same listing
               must queue, and one of them may be granting a period that does not exist yet. */
            @"SELECT li.name, s.id, s.plan_slug, s.source, s.expires_at
              FROM dbo.listings li WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              OUTER APPLY (
                  SELECT TOP (1) id, plan_slug, source, expires_at
                  FROM dbo.subscriptions
                  WHERE listing_id = li.id AND status = 'active' AND expires_at > SYSDATETIMEOFFSET()
                  ORDER BY expires_at DESC
              ) s
              WHERE li.id = @listing AND li.status <> 'archived'", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return (
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetInt64(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetFieldValue<DateTimeOffset>(4));
    }

    /// <summary>A plan that exists and may still be assigned.</summary>
    private static async Task<string?> ActivePlanAsync(
        SqlConnection conn, SqlTransaction tx, string? slug, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(slug))
        {
            return null;
        }

        await using var command = new SqlCommand(
            "SELECT TOP (1) slug FROM dbo.plans WHERE slug = @slug AND is_active = 1", conn, tx);
        command.Parameters.Add(new SqlParameter("slug", SqlDbType.NVarChar) { Value = slug.Trim() });
        return (string?)await command.ExecuteScalarAsync(ct);
    }

    /// <summary>
    /// What the listing remembers having bought, which the entitlements view reports as
    /// `subscribed_plan_slug` so an owner can be told "your Verified plan ended on the 3rd".
    /// Kept in step here exactly as the payment path keeps it (see Payments/Subscriptions).
    /// </summary>
    private static async Task RememberPlan(
        SqlConnection conn, SqlTransaction tx, long listingId, string planSlug, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"UPDATE dbo.listings
              SET plan_slug = @plan, updated_at = SYSDATETIMEOFFSET()
              WHERE id = @listing AND plan_slug <> @plan", conn, tx);
        command.Parameters.Add(new SqlParameter("plan", SqlDbType.NVarChar) { Value = planSlug });
        command.Parameters.AddWithValue("listing", listingId);
        await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Gives a listing a plan nobody paid for.
    /// </summary>
    /// <remarks>
    /// Refused when a period is already in force, with the suggestion to extend or change it
    /// instead. That is what stops two overlapping subscriptions on one listing: the entitlements
    /// view takes the one expiring furthest away, so a second active row would not grant anything
    /// extra -- it would just make "what is this listing on?" ambiguous for everybody reading the
    /// table afterwards.
    /// </remarks>
    private static async Task<IResult> Grant(
        long listingId,
        GrantRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        if (BadReason(request.Reason, out var reason) is { } reasonError)
        {
            return reasonError;
        }
        if (BadMonths(request.Months, out var months) is { } monthsError)
        {
            return monthsError;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var listing = await LockListing(conn, tx, listingId, ct);
        if (listing is null)
        {
            return Results.NotFound();
        }

        if (await ActivePlanAsync(conn, tx, request.PlanSlug, ct) is not { } planSlug)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["planSlug"] = ["Choose a plan that exists and is still on sale."],
            });
        }

        if (listing.Value.SubscriptionId is not null)
        {
            return Results.Problem(
                $"This listing already has a {listing.Value.PlanSlug} period running until "
                + $"{listing.Value.ExpiresAt:d MMM yyyy}. Extend it or change its plan instead of granting a second one.",
                statusCode: StatusCodes.Status409Conflict);
        }

        long id;
        DateTimeOffset startsAt;
        DateTimeOffset expiresAt;
        await using (var insert = new SqlCommand(
            /* starts_at a millisecond in the past, for the reason the payment path documents: the
               column is datetimeoffset(3) and rounding can land it fractionally in the future,
               which the entitlements view reads as "not started yet". */
            @"INSERT INTO dbo.subscriptions
                  (listing_id, plan_slug, status, starts_at, expires_at, source, granted_by_admin_id, grant_reason)
              OUTPUT INSERTED.id, INSERTED.starts_at, INSERTED.expires_at
              VALUES (@listing, @plan, 'active',
                      DATEADD(millisecond, -1, SYSDATETIMEOFFSET()),
                      DATEADD(month, @months, SYSDATETIMEOFFSET()),
                      'complimentary', @admin, @reason)", conn, tx))
        {
            insert.Parameters.AddWithValue("listing", listingId);
            insert.Parameters.Add(new SqlParameter("plan", SqlDbType.NVarChar) { Value = planSlug });
            insert.Parameters.AddWithValue("months", months);
            insert.Parameters.AddWithValue("admin", admin.Id);
            insert.Parameters.Add(new SqlParameter("reason", SqlDbType.NVarChar) { Value = reason });

            await using var reader = await insert.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            id = reader.GetInt64(0);
            startsAt = reader.GetFieldValue<DateTimeOffset>(1);
            expiresAt = reader.GetFieldValue<DateTimeOffset>(2);
        }

        await RememberPlan(conn, tx, listingId, planSlug, ct);

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "subscription.granted", "listing",
            listingId.ToString(CultureInfo.InvariantCulture), http,
            new
            {
                before = new { plan = "free", expiresAt = (DateTimeOffset?)null, source = (string?)null },
                after = new { plan = planSlug, expiresAt, source = ComplimentarySource },
                months,
                reason,
                paymentTaken = false,
            },
            ct);
        await tx.CommitAsync(ct);

        return Results.Ok(new SubscriptionActionResultDto(
            listingId, id, planSlug, ComplimentarySource, startsAt, expiresAt, "active"));
    }

    /// <summary>
    /// Adds time to the period in force, whatever paid for it.
    /// </summary>
    /// <remarks>
    /// Added to what is left rather than to today, so extending a period with four months to run by
    /// one month gives five -- which is what "extend" means to the person pressing it, and what the
    /// payment path already does on a renewal.
    ///
    /// A paid period may be extended, and doing so does <b>not</b> create a payment record: the
    /// money taken is what `subscription_payments` says, and this is a gift of time on top of it.
    /// The audit entry records both, so a reconciliation can tell the two apart.
    /// </remarks>
    private static async Task<IResult> Extend(
        long listingId,
        ExtendRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        if (BadReason(request.Reason, out var reason) is { } reasonError)
        {
            return reasonError;
        }
        if (BadMonths(request.Months, out var months) is { } monthsError)
        {
            return monthsError;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var listing = await LockListing(conn, tx, listingId, ct);
        if (listing is null)
        {
            return Results.NotFound();
        }
        if (listing.Value.SubscriptionId is not { } subscriptionId)
        {
            return Results.Problem(
                "This listing has no period running, so there is nothing to extend. Grant one instead.",
                statusCode: StatusCodes.Status409Conflict);
        }

        DateTimeOffset startsAt;
        DateTimeOffset expiresAt;
        await using (var extend = new SqlCommand(
            @"UPDATE dbo.subscriptions
              SET expires_at = DATEADD(month, @months, expires_at),
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id;
              SELECT starts_at, expires_at FROM dbo.subscriptions WHERE id = @id;", conn, tx))
        {
            extend.Parameters.AddWithValue("months", months);
            extend.Parameters.AddWithValue("id", subscriptionId);
            await using var reader = await extend.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            startsAt = reader.GetFieldValue<DateTimeOffset>(0);
            expiresAt = reader.GetFieldValue<DateTimeOffset>(1);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "subscription.extended", "listing",
            listingId.ToString(CultureInfo.InvariantCulture), http,
            new
            {
                subscriptionId,
                before = new { expiresAt = listing.Value.ExpiresAt, source = listing.Value.Source },
                after = new { expiresAt, source = listing.Value.Source },
                months,
                reason,
                paymentTaken = false,
            },
            ct);
        await tx.CommitAsync(ct);

        return Results.Ok(new SubscriptionActionResultDto(
            listingId, subscriptionId, listing.Value.PlanSlug!, listing.Value.Source!,
            startsAt, expiresAt, "active"));
    }

    /// <summary>
    /// Moves the period in force to a different plan, keeping its dates.
    /// </summary>
    /// <remarks>
    /// For a listing on the wrong tier -- a grant made against the wrong plan, or a business moved
    /// after a conversation. The dates do not change, because this is not a new period: what the
    /// listing may do changes from the moment it is written, which is the entitlements view reading
    /// the new plan's allowances.
    ///
    /// On a <b>paid</b> period this is the one action that needs a second thought, and the reason is
    /// recorded for exactly that: moving a listing that paid for Verified down to Free takes away
    /// something bought. The API allows it because a correction sometimes has to be made; the screen
    /// confirms it, and the audit log keeps the before and the after.
    /// </remarks>
    private static async Task<IResult> ChangePlan(
        long listingId,
        ChangePlanRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        if (BadReason(request.Reason, out var reason) is { } reasonError)
        {
            return reasonError;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var listing = await LockListing(conn, tx, listingId, ct);
        if (listing is null)
        {
            return Results.NotFound();
        }
        if (listing.Value.SubscriptionId is not { } subscriptionId)
        {
            return Results.Problem(
                "This listing has no period running, so there is no plan to change. Grant one instead.",
                statusCode: StatusCodes.Status409Conflict);
        }

        if (await ActivePlanAsync(conn, tx, request.PlanSlug, ct) is not { } planSlug)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["planSlug"] = ["Choose a plan that exists and is still on sale."],
            });
        }
        if (planSlug == listing.Value.PlanSlug)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["planSlug"] = ["That is the plan it is already on."],
            });
        }

        await using (var update = new SqlCommand(
            @"UPDATE dbo.subscriptions
              SET plan_slug = @plan, updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            update.Parameters.Add(new SqlParameter("plan", SqlDbType.NVarChar) { Value = planSlug });
            update.Parameters.AddWithValue("id", subscriptionId);
            await update.ExecuteNonQueryAsync(ct);
        }

        await RememberPlan(conn, tx, listingId, planSlug, ct);

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "subscription.plan_changed", "listing",
            listingId.ToString(CultureInfo.InvariantCulture), http,
            new
            {
                subscriptionId,
                before = new { plan = listing.Value.PlanSlug, source = listing.Value.Source },
                after = new { plan = planSlug, source = listing.Value.Source },
                expiresAt = listing.Value.ExpiresAt,
                reason,
                paymentTaken = false,
            },
            ct);
        await tx.CommitAsync(ct);

        return Results.Ok(new SubscriptionActionResultDto(
            listingId, subscriptionId, planSlug, listing.Value.Source!,
            DateTimeOffset.MinValue, listing.Value.ExpiresAt ?? DateTimeOffset.MinValue, "active"));
    }

    /// <summary>
    /// Ends a complimentary period now.
    /// </summary>
    /// <remarks>
    /// <b>Only a complimentary one.</b> Ending a period somebody paid for is a refund, and a refund
    /// is a Razorpay operation this project does not perform -- so the refusal says that rather than
    /// leaving somebody to wonder why the button did nothing.
    ///
    /// The row is cancelled rather than deleted, and its dates are left alone: the entitlements view
    /// requires `status = 'active'`, so the listing reads as Free from the next request onwards,
    /// while the row still records that a period was granted, by whom, why, and that it was ended.
    /// The listing, its media and its links are untouched (decision D10) -- the Verified extras are
    /// hidden by the view, not deleted.
    /// </remarks>
    private static async Task<IResult> Revoke(
        long listingId,
        RevokeRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        if (BadReason(request.Reason, out var reason) is { } reasonError)
        {
            return reasonError;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var listing = await LockListing(conn, tx, listingId, ct);
        if (listing is null)
        {
            return Results.NotFound();
        }
        if (listing.Value.SubscriptionId is not { } subscriptionId)
        {
            return Results.Problem(
                "This listing has no period running.",
                statusCode: StatusCodes.Status409Conflict);
        }
        if (listing.Value.Source != ComplimentarySource)
        {
            return Results.Problem(
                "This period was paid for, so it cannot be ended here. Refunds are handled in Razorpay, "
                + "and this screen does not touch payments.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await using (var cancel = new SqlCommand(
            @"UPDATE dbo.subscriptions
              SET status = 'cancelled',
                  grant_reason = LEFT(grant_reason + N' | ended: ' + @reason, 1000),
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            cancel.Parameters.AddWithValue("id", subscriptionId);
            cancel.Parameters.Add(new SqlParameter("reason", SqlDbType.NVarChar) { Value = reason });
            await cancel.ExecuteNonQueryAsync(ct);
        }

        /* What the listing remembers having had goes back to free, so its own screen stops offering
           "your Verified plan ended on..." about a period that was taken back rather than lapsed. */
        await RememberPlan(conn, tx, listingId, "free", ct);

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "subscription.revoked", "listing",
            listingId.ToString(CultureInfo.InvariantCulture), http,
            new
            {
                subscriptionId,
                before = new
                {
                    plan = listing.Value.PlanSlug,
                    expiresAt = listing.Value.ExpiresAt,
                    source = listing.Value.Source,
                    status = "active",
                },
                after = new { plan = "free", source = listing.Value.Source, status = "cancelled" },
                reason,
                paymentTaken = false,
                refunded = false,
            },
            ct);
        await tx.CommitAsync(ct);

        return Results.Ok(new SubscriptionActionResultDto(
            listingId, subscriptionId, listing.Value.PlanSlug!, ComplimentarySource,
            DateTimeOffset.MinValue, listing.Value.ExpiresAt ?? DateTimeOffset.MinValue, "cancelled"));
    }
}
