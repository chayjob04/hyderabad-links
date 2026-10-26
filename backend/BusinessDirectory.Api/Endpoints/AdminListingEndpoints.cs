using BusinessDirectory.Api.Data;
using System.Data;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Listings;
using BusinessDirectory.Api.Notifications;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Listing moderation, under /api/v1/admin/listings. Raw parameterised SQL, no ORM.
///
/// An owner submits a listing (status "pending_review") and it stays invisible to the public until an admin
/// approves it. Approving sets "active" and stamps published_at; rejecting sets "rejected" and records the
/// reason the owner will read. Both write a row to audit_logs inside the same transaction as the change,
/// so a decision can never be applied without being recorded.
///
/// Every route is gated twice: the Admin policy only accepts a token with the admin audience, and each
/// handler then checks the permission the action needs against what the database says that admin holds now.
/// </summary>
public static class AdminListingEndpoints
{
    public sealed record RejectRequest(string? Reason);

    /// <summary>One row in the queue: enough to triage without opening the listing.</summary>
    public sealed record QueueItemDto(
        long Id,
        string Name,
        string Status,
        string? CategoryName,
        string LocalityName,
        string? AddressLine,
        string PhonePrimary,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt,
        /// <summary>
        /// Whether this listing is paid up right now, from listing_entitlements. A moderator was
        /// previously given no way to tell a paying business from a free one, which matters when
        /// deciding whether to suspend one.
        /// </summary>
        bool IsVerified,
        DateTimeOffset? PaidUntil);

    public sealed record QueuePageDto(IReadOnlyList<QueueItemDto> Items, int Page, int PageSize, int Total, int TotalPages);

    /// <summary>Everything a reviewer needs to decide, including who submitted it and the last decision taken.</summary>
    public sealed record AdminListingDto(
        long Id,
        string Slug,
        string Name,
        string Status,
        string? Description,
        string? AddressLine,
        string? Pincode,
        string PhonePrimary,
        string? PhoneWhatsapp,
        string? Email,
        string? WebsiteUrl,
        double Latitude,
        double Longitude,
        string CitySlug,
        string LocalitySlug,
        string LocalityName,
        string? CategorySlug,
        string? CategoryName,
        string? SubmittedByPhone,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt,
        DateTimeOffset? PublishedAt,
        string? ReviewNote,
        DateTimeOffset? ReviewedAt,
        string? ReviewedBy,
        /// <summary>Null when the listing has no primary category yet, since the public URL is built from one.</summary>
        string? Url,
        /// <summary>Whether this listing is paid up right now, and until when. From listing_entitlements.</summary>
        bool IsVerified,
        DateTimeOffset? PaidUntil);

    // The category joins are LEFT joins on purpose: a listing with no primary category must still be
    // visible to a reviewer (that missing category is exactly the kind of thing to reject it for),
    // rather than quietly disappearing from the queue.
    private const string DetailSelect =
        @"SELECT li.id, li.slug, li.name, li.status, li.description, li.address_line, li.pincode,
                 li.phone_primary, li.phone_whatsapp, li.email, li.website_url,
                 li.location.Lat, li.location.Long,
                 ci.slug, lo.slug, lo.name, pc.slug, pc.name,
                 u.phone_e164, li.created_at, li.updated_at, li.published_at,
                 li.review_note, li.reviewed_at, ra.display_name,
                 e.is_verified, e.paid_until
          FROM listings li
          JOIN dbo.listing_entitlements e ON e.listing_id = li.id
          JOIN localities lo ON lo.id = li.locality_id
          JOIN cities ci ON ci.id = lo.city_id
          LEFT JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
          LEFT JOIN categories pc ON pc.id = lc.category_id
          LEFT JOIN users u ON u.id = li.created_by_user_id
          LEFT JOIN admin_users ra ON ra.id = li.reviewed_by_admin_id
          WHERE li.id = @id";

    public static RouteGroupBuilder MapAdminListingEndpoints(this RouteGroupBuilder admin)
    {
        /* Read and decide, and nothing else. Adding a business by hand and correcting its details
           used to live here (POST "" and PUT "/{id}"); they are now SuperAdminListingEndpoints, on
           the super-admin surface with its own token audience. An admin reviews what owners submit:
           approve, reject, suspend, reinstate. */
        var group = admin.MapGroup("/listings");
        group.MapGet("", Queue);
        group.MapGet("/{id:long}", Get);
        group.MapPost("/{id:long}/approve", Approve);
        group.MapPost("/{id:long}/reject", Reject);
        group.MapPost("/{id:long}/suspend", Suspend);
        group.MapPost("/{id:long}/reinstate", Reinstate);
        return group;
    }

    // ------------------------------------------------------------------ the queue
    private static async Task<IResult> Queue(
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct,
        string? status = null,
        int? page = null,
        int? pageSize = null)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }
        if (AdminAccess.Authorize(admin, AdminPermissions.ListingsView) is { } refused)
        {
            return refused;
        }

        var query = ModerationQueueQuery.TryCreate(status, page, pageSize, out var error);
        if (query is null)
        {
            return Results.Problem(error, statusCode: StatusCodes.Status400BadRequest);
        }

        // One statement returns the page and the total, so the two can never disagree.
        // The ORDER BY is repeated outside the CTE: ordering only inside it returns the right rows
        // in an arbitrary order (the same lesson as the public search query).
        var sql =
            @"WITH matches AS (
                  SELECT li.id, li.name, li.status, pc.name AS category_name, lo.name AS locality_name,
                         li.address_line, li.phone_primary, li.created_at, li.updated_at,
                         e.is_verified, e.paid_until
                  FROM listings li
                  JOIN dbo.listing_entitlements e ON e.listing_id = li.id
                  JOIN localities lo ON lo.id = li.locality_id
                  LEFT JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
                  LEFT JOIN categories pc ON pc.id = lc.category_id
                  WHERE li.status = @status
              ),
              page AS (
                  SELECT * FROM matches
                  ORDER BY " + (query.OldestFirst ? "created_at ASC" : "updated_at DESC") + @", id ASC
                  OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
              )
              SELECT (SELECT COUNT_BIG(*) FROM matches) AS total,
                     p.id, p.name, p.status, p.category_name, p.locality_name,
                     p.address_line, p.phone_primary, p.created_at, p.updated_at,
                     p.is_verified, p.paid_until
              FROM (SELECT 1 AS one) AS always_one_row
              LEFT JOIN page p ON 1 = 1
              ORDER BY " + (query.OldestFirst ? "p.created_at ASC" : "p.updated_at DESC") + ", p.id ASC";

        await using var command = db.CreateCommand(sql);
        command.Parameters.AddWithValue("status", query.Status);
        command.Parameters.AddWithValue("limit", query.PageSize);
        command.Parameters.AddWithValue("offset", query.Offset);

        var items = new List<QueueItemDto>();
        var total = 0;
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = (int)reader.GetInt64(0);
            if (reader.IsDBNull(1))
            {
                break;   // no rows on this page (an empty queue, or a page past the end), but the total still counts
            }
            items.Add(new QueueItemDto(
                reader.GetInt64(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.GetString(7),
                reader.GetFieldValue<DateTimeOffset>(8),
                reader.GetFieldValue<DateTimeOffset>(9),
                reader.GetBoolean(10),
                reader.IsDBNull(11) ? null : reader.GetFieldValue<DateTimeOffset>(11)));
        }

        var totalPages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)query.PageSize);
        return Results.Ok(new QueuePageDto(items, query.Page, query.PageSize, total, totalPages));
    }

    // ------------------------------------------------------------------ one listing
    private static async Task<IResult> Get(long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }
        if (AdminAccess.Authorize(admin, AdminPermissions.ListingsView) is { } refused)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var listing = await LoadDetail(conn, null, id, ct);
        return listing is null ? Results.NotFound() : Results.Ok(listing);
    }

    // ------------------------------------------------------------------ approve
    private static Task<IResult> Approve(long id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, Notifier notifier, CancellationToken ct) =>
        Decide(id, principal, http, db, notifier, reason: null, ct);

    // ------------------------------------------------------------------ reject
    private static Task<IResult> Reject(long id, RejectRequest request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, Notifier notifier, CancellationToken ct) =>
        Decide(id, principal, http, db, notifier, request.Reason ?? string.Empty, ct);

    /// <summary>
    /// Approving and rejecting differ only in the row they write, so they share the checks:
    /// permission, the listing exists, and it is still waiting for a decision.
    /// A null <paramref name="reason"/> means approve.
    /// </summary>
    private static async Task<IResult> Decide(
        long id,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        Notifier notifier,
        string? reason,
        CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }
        if (AdminAccess.Authorize(admin, AdminPermissions.ListingsReview) is { } refused)
        {
            return refused;
        }

        var approving = reason is null;
        string? cleanReason = null;
        if (!approving)
        {
            cleanReason = RejectionReason.TryClean(reason, out var reasonError);
            if (cleanReason is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = [reasonError!] });
            }
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        // Lock the row so two reviewers cannot both decide on the same listing.
        string currentStatus;
        await using (var find = new SqlCommand("SELECT status FROM listings WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE id = @id", conn, tx))
        {
            find.Parameters.AddWithValue("id", id);
            if (await find.ExecuteScalarAsync(ct) is not string status)
            {
                return Results.NotFound();
            }
            currentStatus = status;
        }

        if (currentStatus != "pending_review")
        {
            return Results.Problem(
                $"This listing is \"{currentStatus}\", not waiting for review. Someone may have decided on it already.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var sql = approving
            // published_at marks when the listing first went live, so a re-approval after a rejection keeps the original date.
            ? @"UPDATE listings
                SET status = 'active',
                    published_at = COALESCE(published_at, SYSDATETIMEOFFSET()),
                    review_note = NULL,
                    reviewed_at = SYSDATETIMEOFFSET(),
                    reviewed_by_admin_id = @admin,
                    updated_at = SYSDATETIMEOFFSET()
                WHERE id = @id"
            : @"UPDATE listings
                SET status = 'rejected',
                    review_note = @reason,
                    reviewed_at = SYSDATETIMEOFFSET(),
                    reviewed_by_admin_id = @admin,
                    updated_at = SYSDATETIMEOFFSET()
                WHERE id = @id";

        await using (var update = new SqlCommand(sql, conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            update.Parameters.AddWithValue("admin", admin.Id);
            if (!approving)
            {
                update.Parameters.AddWithValue("reason", cleanReason!);
            }
            await update.ExecuteNonQueryAsync(ct);
        }

        await WriteAudit(
            conn, tx, admin.Id,
            approving ? "listing.approved" : "listing.rejected",
            id, http,
            approving ? new { previousStatus = currentStatus } : new { previousStatus = currentStatus, reason = cleanReason },
            ct);

        var dto = await LoadDetail(conn, tx, id, ct);

        // Tell the owner what was decided. The notification row goes in with the decision itself, so
        // a listing can never be approved or rejected without a record of what we tried to send.
        long? notificationId = null;
        EmailMessage? email = null;
        var owner = await OwnerLookup.ForListing(conn, tx, id, ct);
        if (owner is not null && dto is not null)
        {
            var decision = new EmailTemplates.ListingDecision(dto.Name, dto.Url, cleanReason);
            notificationId = await Notifier.RecordPendingEmailAsync(
                conn, tx,
                approving ? NotificationKinds.ListingApproved : NotificationKinds.ListingRejected,
                owner.Email, owner.UserId, "listing", id, ct);
            email = approving
                ? EmailTemplates.ListingApprovedEmail(owner.Email, decision, notifier.SiteBaseUrl)
                : EmailTemplates.ListingRejectedEmail(owner.Email, decision, notifier.SiteBaseUrl);
        }

        await tx.CommitAsync(ct);

        // After the commit, and never allowed to fail the decision: the moderator's work is done and
        // recorded, and a delivery failure shows up as a 'failed' notification row.
        if (notificationId is not null)
        {
            await notifier.DeliverAsync(conn, notificationId.Value, email!, ct);
        }

        return Results.Ok(dto);
    }

    // ------------------------------------------------------------------ suspend / reinstate
    private static Task<IResult> Suspend(
        long id, RejectRequest request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        ChangeLiveStatus(id, suspending: true, request.Reason, principal, http, db, ct);

    private static Task<IResult> Reinstate(
        long id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        ChangeLiveStatus(id, suspending: false, reason: null, principal, http, db, ct);

    /// <summary>
    /// Takes a live listing off the site, or puts a suspended one back.
    ///
    /// This is moderation of something already published, so it is gated on the same
    /// <c>listings.review</c> permission as approving and rejecting rather than on a new one: an
    /// account trusted to publish a listing is the one trusted to unpublish it.
    ///
    /// The reason is stored in <c>review_note</c>, the same column a rejection uses, so the owner
    /// sees why on the screens that already read it. Suspending never touches
    /// <c>published_at</c>: the listing was live, and reinstating it should not look like a new one.
    /// </summary>
    private static async Task<IResult> ChangeLiveStatus(
        long id,
        bool suspending,
        string? reason,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }
        if (AdminAccess.Authorize(admin, AdminPermissions.ListingsReview) is { } refused)
        {
            return refused;
        }

        string? cleanReason = null;
        if (suspending)
        {
            // The owner is told why their listing disappeared, so a reason is required here.
            cleanReason = RejectionReason.TryClean(reason, out var reasonError);
            if (cleanReason is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = [reasonError!] });
            }
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        string currentStatus;
        await using (var find = new SqlCommand("SELECT status FROM listings WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE id = @id", conn, tx))
        {
            find.Parameters.AddWithValue("id", id);
            if (await find.ExecuteScalarAsync(ct) is not string status)
            {
                return Results.NotFound();
            }
            currentStatus = status;
        }

        var expected = suspending ? "active" : "suspended";
        if (currentStatus != expected)
        {
            return Results.Problem(
                suspending
                    ? $"Only a live listing can be suspended. This one is \"{currentStatus}\"."
                    : $"Only a suspended listing can be put back. This one is \"{currentStatus}\".",
                statusCode: StatusCodes.Status409Conflict);
        }

        await using (var update = new SqlCommand(
            suspending
                ? @"UPDATE listings
                    SET status = 'suspended', review_note = @reason, reviewed_at = SYSDATETIMEOFFSET(),
                        reviewed_by_admin_id = @admin, updated_at = SYSDATETIMEOFFSET()
                    WHERE id = @id"
                : @"UPDATE listings
                    SET status = 'active', review_note = NULL, reviewed_at = SYSDATETIMEOFFSET(),
                        reviewed_by_admin_id = @admin, updated_at = SYSDATETIMEOFFSET()
                    WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            update.Parameters.AddWithValue("admin", admin.Id);
            if (suspending)
            {
                update.Parameters.AddWithValue("reason", cleanReason!);
            }
            await update.ExecuteNonQueryAsync(ct);
        }

        await WriteAudit(
            conn, tx, admin.Id,
            suspending ? "listing.suspended" : "listing.reinstated",
            id, http,
            suspending ? new { previousStatus = currentStatus, reason = cleanReason } : new { previousStatus = currentStatus },
            ct);

        var dto = await LoadDetail(conn, tx, id, ct);
        await tx.CommitAsync(ct);
        return Results.Ok(dto);
    }

    // ------------------------------------------------------------------ helpers
    /// <summary>
    /// Internal, not private: SuperAdminListingEndpoints writes the listings this reads, and returns
    /// the same shape, so both surfaces describe a listing identically.
    /// </summary>
    internal static async Task<AdminListingDto?> LoadDetail(SqlConnection conn, SqlTransaction? tx, long id, CancellationToken ct)
    {
        await using var command = new SqlCommand(DetailSelect, conn, tx);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        var city = reader.GetString(13);
        var locality = reader.GetString(14);
        var category = reader.IsDBNull(16) ? null : reader.GetString(16);
        var slug = reader.GetString(1);
        return new AdminListingDto(
            reader.GetInt64(0),
            slug,
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.GetString(7),
            reader.IsDBNull(8) ? null : reader.GetString(8),
            reader.IsDBNull(9) ? null : reader.GetString(9),
            reader.IsDBNull(10) ? null : reader.GetString(10),
            reader.GetDouble(11),
            reader.GetDouble(12),
            city,
            locality,
            reader.GetString(15),
            category,
            reader.IsDBNull(17) ? null : reader.GetString(17),
            reader.IsDBNull(18) ? null : reader.GetString(18),
            reader.GetFieldValue<DateTimeOffset>(19),
            reader.GetFieldValue<DateTimeOffset>(20),
            reader.IsDBNull(21) ? null : reader.GetFieldValue<DateTimeOffset>(21),
            reader.IsDBNull(22) ? null : reader.GetString(22),
            reader.IsDBNull(23) ? null : reader.GetFieldValue<DateTimeOffset>(23),
            reader.IsDBNull(24) ? null : reader.GetString(24),
            category is null ? null : $"/{city}/{locality}/{category}/{slug}",
            reader.GetBoolean(25),
            reader.IsDBNull(26) ? null : reader.GetFieldValue<DateTimeOffset>(26));
    }

    /// <summary>
    /// Writes the decision to the append-only audit log in the same transaction as the change itself.
    /// details carries the reason given to the owner; it never carries secrets.
    /// </summary>
    private static async Task WriteAudit(
        SqlConnection conn,
        SqlTransaction tx,
        long adminId,
        string action,
        long listingId,
        HttpContext http,
        object details,
        CancellationToken ct)
    {
        IPAddress? ip = http.Connection.RemoteIpAddress;
        await using var command = new SqlCommand(
            @"INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, details, ip)
              VALUES ('admin', @admin, @action, 'listing', @entity, @details, @ip)", conn, tx);
        command.Parameters.AddWithValue("admin", adminId);
        command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("entity", listingId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        command.Parameters.Add(new SqlParameter("details", SqlDbType.NVarChar) { Value = JsonSerializer.Serialize(details) });
        command.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
        await command.ExecuteNonQueryAsync(ct);
    }
}
