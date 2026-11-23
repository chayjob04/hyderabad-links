using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Who is paying, what for, and until when — under /api/v1/super-admin/subscriptions.
///
/// Everything a subscription needs already existed: <c>plans</c>, <c>subscriptions</c>,
/// <c>subscription_payments</c>, and <c>listing_entitlements</c>, which is the one definition of
/// "is this listing paid up right now". What did not exist was any way for the platform owner to
/// see it. The owner of one listing can see that listing's plan; nobody could see the whole table,
/// so "how many Verified listings are there, and whose lapse this month" had no answer short of a
/// query against production.
///
/// <b>It reads and nothing else.</b> There is no endpoint here to grant a plan, extend a period,
/// change a price or refund a payment, and that is deliberate rather than unfinished: each of those
/// is money, and the project's standing rule is that payment behaviour is not changed without the
/// owner's say-so. The screen says as much, so nobody goes looking for a button that was quietly
/// left out. What a plan costs is still changed by an UPDATE on <c>plans</c>, the way the pricing
/// page has always read it.
///
/// Expiry is a comparison against the clock, done by the view — a period that ran out an hour ago
/// reads as lapsed here with no job having run.
/// </summary>
public static class SuperAdminSubscriptionEndpoints
{
    /// <summary>How soon counts as "expiring", for the figure on the summary and the filter.</summary>
    public const int ExpiringWithinDays = 30;

    public const int DefaultPageSize = 25;
    public const int MaxPageSize = 100;

    /// <summary>
    /// Which listings to list. Every one of these is derived from the entitlement view and the
    /// clock, so none of them can disagree with what the owner's own screen says.
    /// </summary>
    public static readonly string[] States = ["all", "verified", "expiring", "lapsed", "free"];

    /// <param name="EffectivePlanSlug">What is in force now: 'free' the moment a period lapses.</param>
    /// <param name="SubscribedPlanSlug">What was last bought, which is what makes "ended on the 3rd" sayable.</param>
    /// <param name="DaysRemaining">
    /// Whole days left on the period, negative once it has passed, null when nothing was ever
    /// bought. Worked out in SQL against the same clock the view uses, so the figure and the plan
    /// beside it cannot come from two different moments.
    /// </param>
    public sealed record SubscriptionRowDto(
        long ListingId,
        string ListingName,
        string ListingStatus,
        string LocalityName,
        string? OwnerPhone,
        string EffectivePlanSlug,
        string EffectivePlanName,
        bool Verified,
        DateTimeOffset? PaidUntil,
        int? DaysRemaining,
        string SubscribedPlanSlug,
        /// <summary>The most recent payment on this listing, whatever its state. Null when there is none.</summary>
        DateTimeOffset? LastPaymentAt,
        string? LastPaymentStatus,
        long? LastPaymentPaise,
        /// <summary>
        /// The provider's own reference for that payment, for reconciliation against their
        /// dashboard. An identifier, not a credential: it authorises nothing and is shown to the
        /// payer too.
        /// </summary>
        string? LastPaymentReference,

        /// <summary>
        /// How the period in force came about: `payment` or `complimentary` (S0033). Null when
        /// there is none.
        ///
        /// This is the column that keeps a gift from being read as revenue. A complimentary period
        /// grants exactly what a paid one grants -- the entitlements view does not care how a
        /// subscription arrived -- so without it the two are indistinguishable in any report.
        /// </summary>
        string? Source = null,

        /// <summary>Why it was granted, for a complimentary period. Required when one is granted.</summary>
        string? GrantReason = null,

        /// <summary>Who granted it. Null when the admin account has since been removed.</summary>
        string? GrantedBy = null,

        /// <summary>
        /// The listing's public page, or null when it has no primary category yet.
        ///
        /// Sent because granting or ending a period changes what that page may show -- the badge,
        /// the photos, the named links -- so the screen's actions refresh it. Composed here with
        /// PublicUrl rather than built from an id on the website, which is how dead paths were
        /// produced everywhere else it was tried.
        /// </summary>
        string? Url = null);

    /// <param name="Verified">Listings whose paid period is in force right now.</param>
    /// <param name="Expiring">Of those, how many run out within <see cref="ExpiringWithinDays"/> days.</param>
    /// <param name="Lapsed">Listings that bought a period which has since run out.</param>
    /// <param name="NeverPaid">Listings that have never had a subscription row.</param>
    /// <param name="PaidPaiseAllTime">Everything taken, in paise, counting only payments marked paid.</param>
    public sealed record SubscriptionSummaryDto(
        int Listings,
        int Verified,
        int Expiring,
        int Lapsed,
        int NeverPaid,
        int PaidPayments,
        long PaidPaiseAllTime,
        long PaidPaiseLast30Days,
        int RefundedPayments,
        int FailedPayments,

        /// <summary>
        /// Periods in force that nobody paid for (S0033). Counted separately from `Verified`,
        /// because "how many listings are Verified" and "how many of those are paying" are
        /// different questions and the second one is the one that pays for the platform.
        /// </summary>
        int Complimentary = 0);

    /// <param name="PricePaise">In paise, as the table stores it, so nothing rounds in transit.</param>
    public sealed record PlanRowDto(
        string Slug,
        string Name,
        long PricePaise,
        int PhotoLimit,
        int VideoLimit,
        int LogoLimit,
        int FaqLimit,
        int ContentSectionLimit,
        bool GrantsVerifiedBadge,
        bool MediaLimitsConfirmed,
        bool IsActive,
        /// <summary>Listings on this plan right now, by the entitlement view's reckoning.</summary>
        int ListingsOnPlan);

    public sealed record SubscriptionsPageDto(
        IReadOnlyList<SubscriptionRowDto> Items,
        int Page,
        int PageSize,
        int Total,
        int TotalPages,
        string State,
        SubscriptionSummaryDto Summary,
        IReadOnlyList<PlanRowDto> Plans,
        /// <summary>
        /// Whether this caller may grant, extend, move or end a period by hand (S0033).
        ///
        /// It was always false when this screen only read. It is now the one answer the screen asks
        /// for, rather than each form deciding for itself: the API checks the permission on every
        /// write regardless, so this only decides whether a control that would be refused is drawn
        /// at all.
        /// </summary>
        bool CanWrite);

    public static RouteGroupBuilder MapSuperAdminSubscriptionEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/subscriptions", List);
        return group;
    }

    private static async Task<IResult> List(
        string? state,
        int page,
        int pageSize,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }

        /* plans.manage, which only the platform owner's role holds. Seeing what every business pays
           is not moderation work, and the ordinary admin role is deliberately without it. */
        if (AdminAccess.AuthorizeSuper(admin, AdminPermissions.PlansManage) is { } refusal)
        {
            return refusal;
        }

        var wanted = string.IsNullOrWhiteSpace(state) ? "all" : state.Trim().ToLowerInvariant();
        if (!States.Contains(wanted))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["state"] = [$"Unknown filter. Expected one of: {string.Join(", ", States)}."],
            });
        }

        var currentPage = page < 1 ? 1 : page;
        var size = pageSize < 1 ? DefaultPageSize : Math.Min(pageSize, MaxPageSize);

        await using var conn = await db.OpenConnectionAsync(ct);

        var summary = await ReadSummary(conn, ct);
        var plans = await ReadPlans(conn, ct);
        var (items, total) = await ReadPage(conn, wanted, currentPage, size, ct);

        var totalPages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)size);
        /* The same permission the write endpoints check. Reading and writing are behind one
           permission here on purpose: anyone who may see every business's plan is the platform
           owner, and the alternative -- a read-only subscription role -- is a role nobody asked
           for and another thing to keep right. */
        return Results.Ok(new SubscriptionsPageDto(
            items, currentPage, size, total, totalPages, wanted, summary, plans, CanWrite: true));
    }

    /// <summary>
    /// One row per listing, with the plan in force and the latest payment.
    /// </summary>
    /// <remarks>
    /// The filters are applied to the same expressions the row carries, rather than to a stored
    /// flag, so a listing cannot be counted as verified in one place and lapsed in another. The
    /// ordering puts the periods that run out soonest first, because that is the list somebody
    /// actually acts on; listings that never paid sort last.
    /// </remarks>
    private static async Task<(List<SubscriptionRowDto> Items, int Total)> ReadPage(
        SqlConnection conn, string state, int page, int size, CancellationToken ct)
    {
        var filter = state switch
        {
            "verified" => "e.is_verified = 1 AND e.paid_until > SYSDATETIMEOFFSET()",
            "expiring" => "e.is_verified = 1 AND e.paid_until > SYSDATETIMEOFFSET() "
                          + "AND e.paid_until <= DATEADD(day, @window, SYSDATETIMEOFFSET())",
            // Bought something once, and it is not in force now.
            "lapsed" => "last.bought_at IS NOT NULL AND (e.paid_until IS NULL OR e.paid_until <= SYSDATETIMEOFFSET())",
            "free" => "last.bought_at IS NULL",
            _ => "1 = 1",
        };

        var sql =
            @"WITH rows AS (
                  SELECT li.id, li.name, li.status, lo.name AS locality_name, u.phone_e164,
                         e.effective_plan_slug, e.effective_plan_name, e.is_verified,
                         e.paid_until, e.subscribed_plan_slug,
                         CASE WHEN e.paid_until IS NULL THEN NULL
                              ELSE DATEDIFF(day, SYSDATETIMEOFFSET(), e.paid_until) END AS days_remaining,
                         pay.created_at AS last_payment_at, pay.status AS last_payment_status,
                         pay.amount_paise AS last_payment_paise,
                         COALESCE(pay.provider_payment_id, pay.provider_order_id) AS last_payment_reference,
                         live.source, live.grant_reason, ga.display_name AS granted_by,
                         li.slug, pc.slug AS category_slug, pcparent.slug AS parent_category_slug,
                         last.bought_at
                  FROM dbo.listings li
                  JOIN dbo.listing_entitlements e ON e.listing_id = li.id
                  JOIN dbo.localities lo ON lo.id = li.locality_id
                  LEFT JOIN dbo.users u ON u.id = li.created_by_user_id
                  /* The period in force, for how it came about. The entitlement view says what the
                     listing may do; it does not say who paid, which is the question a report about
                     revenue has to be able to answer. */
                  OUTER APPLY (
                      SELECT TOP (1) s.source, s.grant_reason, s.granted_by_admin_id
                      FROM dbo.subscriptions s
                      WHERE s.listing_id = li.id
                        AND s.status = 'active'
                        AND s.starts_at <= SYSDATETIMEOFFSET()
                        AND s.expires_at > SYSDATETIMEOFFSET()
                      ORDER BY s.expires_at DESC
                  ) live
                  LEFT JOIN dbo.admin_users ga ON ga.id = live.granted_by_admin_id
                  LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
                  LEFT JOIN dbo.categories pc ON pc.id = lc.category_id
                  LEFT JOIN dbo.categories pcparent ON pcparent.id = pc.parent_id
                  -- Has this listing ever bought a period? That is what separates 'lapsed' from
                  -- 'never paid', and the entitlement view cannot say: both read as free.
                  OUTER APPLY (
                      SELECT MAX(s.created_at) AS bought_at
                      FROM dbo.subscriptions s
                      WHERE s.listing_id = li.id
                  ) last
                  OUTER APPLY (
                      SELECT TOP (1) p.created_at, p.status, p.amount_paise,
                             p.provider_payment_id, p.provider_order_id
                      FROM dbo.subscription_payments p
                      WHERE p.listing_id = li.id
                      ORDER BY p.created_at DESC, p.id DESC
                  ) pay
                  /* Staged edits and unsaved new listings are not businesses with a
                     subscription (S0034). A staged copy inherits its parent's period through the
                     entitlements view, so listing one here would show the same subscription twice
                     and the figures above would count it twice. */
                  WHERE li.staged_for_listing_id IS NULL
                    AND li.is_placeholder = 0
                    AND (" + filter + @")
              ),
              page AS (
                  SELECT * FROM rows
                  /* Soonest to run out first; never-paid last. A null paid_until sorts first in SQL
                     Server, which would put every free listing above the ones that need attention. */
                  ORDER BY CASE WHEN paid_until IS NULL THEN 1 ELSE 0 END, paid_until ASC, id ASC
                  OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
              )
              SELECT (SELECT COUNT_BIG(*) FROM rows) AS total,
                     p.id, p.name, p.status, p.locality_name, p.phone_e164,
                     p.effective_plan_slug, p.effective_plan_name, p.is_verified,
                     p.paid_until, p.days_remaining, p.subscribed_plan_slug,
                     p.last_payment_at, p.last_payment_status, p.last_payment_paise,
                     p.last_payment_reference, p.source, p.grant_reason, p.granted_by,
                     p.slug, p.category_slug, p.parent_category_slug
              FROM (SELECT 1 AS one) AS always_one_row
              LEFT JOIN page p ON 1 = 1
              ORDER BY CASE WHEN p.paid_until IS NULL THEN 1 ELSE 0 END, p.paid_until ASC, p.id ASC";

        await using var command = new SqlCommand(sql, conn);
        command.Parameters.AddWithValue("window", ExpiringWithinDays);
        command.Parameters.AddWithValue("limit", size);
        command.Parameters.AddWithValue("offset", (page - 1) * size);

        var items = new List<SubscriptionRowDto>();
        var total = 0;
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = (int)reader.GetInt64(0);
            if (reader.IsDBNull(1))
            {
                break;   // a page past the end, or nothing matched; the total still counts
            }
            items.Add(new SubscriptionRowDto(
                reader.GetInt64(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetString(6),
                reader.GetString(7),
                reader.GetBoolean(8),
                reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9),
                reader.IsDBNull(10) ? null : reader.GetInt32(10),
                reader.GetString(11),
                reader.IsDBNull(12) ? null : reader.GetFieldValue<DateTimeOffset>(12),
                reader.IsDBNull(13) ? null : reader.GetString(13),
                reader.IsDBNull(14) ? null : reader.GetInt64(14),
                reader.IsDBNull(15) ? null : reader.GetString(15),
                reader.IsDBNull(16) ? null : reader.GetString(16),
                reader.IsDBNull(17) ? null : reader.GetString(17),
                reader.IsDBNull(18) ? null : reader.GetString(18),
                Listings.PublicUrl.ForListing(
                    reader.IsDBNull(21) ? null : reader.GetString(21),
                    reader.IsDBNull(20) ? null : reader.GetString(20),
                    reader.GetString(19))));
        }

        return (items, total);
    }

    /// <summary>The figures across the top, counted in one statement so they agree with each other.</summary>
    private static async Task<SubscriptionSummaryDto> ReadSummary(SqlConnection conn, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT
                  /* Every count here is over real listings. A staged edit is a row in
                     `listings` that inherits its parent's period (S0034), so counting the view on
                     its own would report one paid listing as two -- which is the figure this screen
                     exists to get right. */
                  (SELECT COUNT_BIG(*) FROM dbo.listings
                   WHERE staged_for_listing_id IS NULL AND is_placeholder = 0) AS listings,
                  (SELECT COUNT_BIG(*) FROM dbo.listing_entitlements e
                   JOIN dbo.listings li ON li.id = e.listing_id
                   WHERE li.staged_for_listing_id IS NULL AND li.is_placeholder = 0
                     AND e.is_verified = 1 AND e.paid_until > SYSDATETIMEOFFSET()) AS verified,
                  (SELECT COUNT_BIG(*) FROM dbo.listing_entitlements e
                   JOIN dbo.listings li ON li.id = e.listing_id
                   WHERE li.staged_for_listing_id IS NULL AND li.is_placeholder = 0
                     AND e.is_verified = 1 AND e.paid_until > SYSDATETIMEOFFSET()
                     AND e.paid_until <= DATEADD(day, @window, SYSDATETIMEOFFSET())) AS expiring,
                  (SELECT COUNT_BIG(*) FROM dbo.listings li
                   JOIN dbo.listing_entitlements e ON e.listing_id = li.id
                   WHERE li.staged_for_listing_id IS NULL AND li.is_placeholder = 0
                     AND EXISTS (SELECT 1 FROM dbo.subscriptions s WHERE s.listing_id = li.id)
                     AND (e.paid_until IS NULL OR e.paid_until <= SYSDATETIMEOFFSET())) AS lapsed,
                  (SELECT COUNT_BIG(*) FROM dbo.listings li
                   WHERE li.staged_for_listing_id IS NULL AND li.is_placeholder = 0
                     AND NOT EXISTS (SELECT 1 FROM dbo.subscriptions s WHERE s.listing_id = li.id)) AS never_paid,
                  (SELECT COUNT_BIG(*) FROM dbo.subscription_payments WHERE status = 'paid') AS paid_payments,
                  (SELECT COALESCE(SUM(amount_paise), 0) FROM dbo.subscription_payments
                   WHERE status = 'paid') AS paid_all_time,
                  (SELECT COALESCE(SUM(amount_paise), 0) FROM dbo.subscription_payments
                   WHERE status = 'paid'
                     AND COALESCE(paid_at, created_at) > DATEADD(day, -30, SYSDATETIMEOFFSET())) AS paid_30,
                  (SELECT COUNT_BIG(*) FROM dbo.subscription_payments WHERE status = 'refunded') AS refunded,
                  (SELECT COUNT_BIG(*) FROM dbo.subscription_payments WHERE status = 'failed') AS failed,
                  (SELECT COUNT_BIG(*) FROM dbo.subscriptions s
                   WHERE s.source = 'complimentary'
                     AND s.status = 'active'
                     AND s.starts_at <= SYSDATETIMEOFFSET()
                     AND s.expires_at > SYSDATETIMEOFFSET()) AS complimentary",
            conn);
        command.Parameters.AddWithValue("window", ExpiringWithinDays);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return new SubscriptionSummaryDto(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }

        return new SubscriptionSummaryDto(
            (int)reader.GetInt64(0),
            (int)reader.GetInt64(1),
            (int)reader.GetInt64(2),
            (int)reader.GetInt64(3),
            (int)reader.GetInt64(4),
            (int)reader.GetInt64(5),
            reader.GetInt64(6),
            reader.GetInt64(7),
            (int)reader.GetInt64(8),
            (int)reader.GetInt64(9),
            (int)reader.GetInt64(10));
    }

    /// <summary>
    /// The plans as the table has them, with how many listings are on each right now.
    ///
    /// Every tier, including a deactivated one: the pricing page shows only what is on sale, but a
    /// listing can still be sitting on a tier nobody may buy any more, and hiding it here would
    /// make those listings unaccountable.
    /// </summary>
    private static async Task<List<PlanRowDto>> ReadPlans(SqlConnection conn, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT p.slug, p.name, p.price_paise, p.photo_limit, p.video_limit, p.logo_limit,
                     p.faq_limit, p.content_section_limit, p.grants_verified_badge,
                     p.media_limits_confirmed, p.is_active,
                     (SELECT COUNT_BIG(*) FROM dbo.listing_entitlements e
                      JOIN dbo.listings li ON li.id = e.listing_id
                      WHERE li.staged_for_listing_id IS NULL AND li.is_placeholder = 0
                        AND e.effective_plan_slug = p.slug) AS listings_on_plan
              FROM dbo.plans p
              ORDER BY p.sort_order, p.slug", conn);

        var plans = new List<PlanRowDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            plans.Add(new PlanRowDto(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetInt64(2),
                reader.GetInt32(3),
                reader.GetInt32(4),
                reader.GetInt32(5),
                reader.GetInt32(6),
                reader.GetInt32(7),
                reader.GetBoolean(8),
                reader.GetBoolean(9),
                reader.GetBoolean(10),
                (int)reader.GetInt64(11)));
        }

        return plans;
    }
}
