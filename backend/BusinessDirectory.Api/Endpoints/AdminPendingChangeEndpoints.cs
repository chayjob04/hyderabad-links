using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Edits to listings that are already published, waiting for a decision — /api/v1/admin/listing-changes.
///
/// A listing that has never been published is reviewed as a whole: it sits in the moderation queue
/// with status 'pending_review' and approving it puts it on the site. An edit to a listing that is
/// already on the site cannot work that way, because taking a live business down while somebody
/// reads a changed phone number is a worse answer than either outcome. So the edit is staged
/// (S0031) and this is where it is read, compared and decided.
///
/// Same permission as the listing queue, <c>listings.review</c>: it is the same judgement about the
/// same kind of content, and an account that may approve a new listing may approve a change to one.
///
/// <b>Approving publishes it. Rejecting keeps it.</b> A refused edit stays staged with the note
/// attached, so its owner opens the form on their own text and the moderator's words, rather than
/// on the live version with their work gone.
/// </summary>
public static class AdminPendingChangeEndpoints
{
    public sealed record RejectRequest(string? Reason);

    /// <param name="FieldsChanged">How many of the staged values differ from what is published.</param>
    public sealed record QueueItemDto(
        long ListingId,
        string ListingName,
        string ListingStatus,
        string LocalityName,
        string Status,
        DateTimeOffset? SubmittedAt,
        DateTimeOffset UpdatedAt,
        int FieldsChanged);

    /// <summary>One field, as published and as proposed. `Changed` is what the screen highlights.</summary>
    public sealed record FieldComparisonDto(string Field, string Label, string? Current, string? Proposed, bool Changed);

    public sealed record ComparisonDto(
        long ListingId,
        string ListingName,
        string ListingStatus,
        string? Url,
        string Status,
        DateTimeOffset? SubmittedAt,
        string? ReviewNote,
        IReadOnlyList<FieldComparisonDto> Fields);

    public static RouteGroupBuilder MapAdminPendingChangeEndpoints(this RouteGroupBuilder admin)
    {
        var group = admin.MapGroup("/listing-changes");
        group.MapGet("", Queue);
        group.MapGet("/{listingId:long}", Compare);
        group.MapPost("/{listingId:long}/approve", Approve);
        group.MapPost("/{listingId:long}/reject", Reject);
        return admin;
    }

    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return (null, Results.Unauthorized());
        }
        return (admin, AdminAccess.Authorize(admin, AdminPermissions.ListingsReview));
    }

    /// <summary>
    /// What is waiting. Submitted edits only by default — a draft is private to its owner, and a
    /// rejected one is theirs to fix, so neither belongs in somebody's work queue.
    /// </summary>
    /// <param name="status">
    /// `pending_review` (the default), `rejected`, or `all` to see everything that is staged,
    /// which is how a moderator checks whether their note was acted on.
    /// </param>
    private static async Task<IResult> Queue(
        string? status, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var wanted = string.IsNullOrWhiteSpace(status) ? PendingChanges.PendingReview : status.Trim().ToLowerInvariant();
        if (wanted != "all" && wanted != PendingChanges.PendingReview && wanted != PendingChanges.Rejected
            && wanted != PendingChanges.Draft)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["status"] = ["Expected pending_review, rejected, draft or all."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            /* The count of differing fields is worked out in SQL so the queue can show it without
               loading every value: a moderator triaging twenty edits wants to know which one is a
               rewrite and which is a corrected digit. NULL-safe comparison on both sides, because
               clearing a field is a change and `<>` would miss it. */
            @"SELECT p.listing_id, li.name, li.status, lo.name AS locality_name,
                     p.status, p.submitted_at, p.updated_at,
                     (CASE WHEN ISNULL(p.name, N'')          <> ISNULL(li.name, N'')          THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(p.description, N'')   <> ISNULL(li.description, N'')   THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(p.address_line, N'')  <> ISNULL(li.address_line, N'')  THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(p.pincode, N'')       <> ISNULL(li.pincode, N'')       THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(p.phone_primary, '')  <> ISNULL(li.phone_primary, '')  THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(p.phone_whatsapp, '') <> ISNULL(li.phone_whatsapp, '') THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(p.website_url, N'')   <> ISNULL(li.website_url, N'')   THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(p.category_id, 0)     <> ISNULL(lc.category_id, 0)     THEN 1 ELSE 0 END
                     ) AS fields_changed
              FROM dbo.listing_pending_changes p
              JOIN dbo.listings li ON li.id = p.listing_id
              JOIN dbo.localities lo ON lo.id = li.locality_id
              LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              WHERE (@status = 'all' OR p.status = @status)
              ORDER BY CASE WHEN p.status = 'pending_review' THEN 0 ELSE 1 END,
                       p.submitted_at ASC, p.updated_at ASC", conn);
        command.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar) { Value = wanted });

        var items = new List<QueueItemDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new QueueItemDto(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5),
                reader.GetFieldValue<DateTimeOffset>(6),
                reader.GetInt32(7)));
        }

        return Results.Ok(items);
    }

    /// <summary>
    /// The published version beside the proposed one, field by field.
    /// </summary>
    /// <remarks>
    /// Built here rather than on the website so that both sides of the comparison come from one
    /// read of one database, in one order. A screen that fetched the listing and the staged edit
    /// separately could show a difference that had already been approved between the two requests.
    /// </remarks>
    private static async Task<IResult> Compare(
        long listingId, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var comparison = await LoadComparison(conn, null, listingId, ct);
        return comparison is null ? Results.NotFound() : Results.Ok(comparison);
    }

    private static async Task<ComparisonDto?> LoadComparison(
        SqlConnection conn, SqlTransaction? tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT li.name, li.status, li.description, li.address_line, li.pincode,
                     li.phone_primary, li.phone_whatsapp, li.website_url,
                     pc.name AS category_name, pcparent.slug AS parent_category_slug, pc.slug AS category_slug,
                     li.slug,
                     p.status, p.submitted_at, p.review_note,
                     p.name, p.description, p.address_line, p.pincode,
                     p.phone_primary, p.phone_whatsapp, p.website_url,
                     sc.name AS staged_category_name
              FROM dbo.listing_pending_changes p
              JOIN dbo.listings li ON li.id = p.listing_id
              LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              LEFT JOIN dbo.categories pc ON pc.id = lc.category_id
              LEFT JOIN dbo.categories pcparent ON pcparent.id = pc.parent_id
              LEFT JOIN dbo.categories sc ON sc.id = p.category_id
              WHERE p.listing_id = @listing", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        string? Text(int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

        var fields = new List<FieldComparisonDto>
        {
            Field("name", "Business name", Text(0), Text(15)),
            Field("categoryName", "Category", Text(8), Text(22)),
            Field("addressLine", "Address", Text(3), Text(17)),
            Field("pincode", "Pincode", Text(4), Text(18)),
            Field("phonePrimary", "Phone", Text(5), Text(19)),
            Field("phoneWhatsapp", "WhatsApp", Text(6), Text(20)),
            Field("websiteUrl", "Website", Text(7), Text(21)),
            Field("description", "Description", Text(2), Text(16)),
        };

        return new ComparisonDto(
            listingId,
            reader.GetString(0),
            reader.GetString(1),
            PublicUrl.ForListing(Text(9), Text(10), reader.GetString(11)),
            reader.GetString(12),
            reader.IsDBNull(13) ? null : reader.GetFieldValue<DateTimeOffset>(13),
            Text(14),
            fields);
    }

    /// <summary>
    /// One row of the comparison. Blank and null are the same thing to a reader, so they are the
    /// same thing here: an owner who clears a field and one who never filled it in have both left
    /// it empty, and that is not a change worth highlighting.
    /// </summary>
    private static FieldComparisonDto Field(string field, string label, string? current, string? proposed) =>
        new(field, label, current, proposed,
            !string.Equals(current?.Trim() ?? "", proposed?.Trim() ?? "", StringComparison.Ordinal));

    /// <summary>
    /// Publishes the staged edit.
    /// </summary>
    /// <remarks>
    /// Everything happens in one transaction: the listing is updated, its primary category is set
    /// if the edit moved it, the decision is written to the audit log, and the staged row is
    /// removed. A half-applied approval would publish a name without its category.
    ///
    /// The staged row is locked as it is read, so two moderators pressing Approve at the same moment
    /// queue rather than both applying it -- the second one finds no row and is told so.
    /// </remarks>
    private static async Task<IResult> Approve(
        long listingId,
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

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var staged = await LockStaged(conn, tx, listingId, ct);
        if (staged is null)
        {
            return Results.NotFound();
        }

        if (staged.Status == PendingChanges.Draft)
        {
            /* Not submitted. The owner is still working on it, and approving something nobody has
               asked to be looked at would publish text they had not finished. */
            return Results.Problem(
                "These changes have not been submitted for review yet.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await PendingChanges.ApplyAsync(conn, tx, staged, admin.Id, ct);
        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.changes_approved", "listing",
            listingId.ToString(System.Globalization.CultureInfo.InvariantCulture), http,
            new { previousStatus = staged.Status }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    /// <summary>
    /// Refuses the staged edit and tells the owner why. The published listing is not touched.
    /// </summary>
    private static async Task<IResult> Reject(
        long listingId,
        RejectRequest request,
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

        var reason = request.Reason?.Trim();
        if (string.IsNullOrEmpty(reason))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["reason"] = ["Say what needs changing. The owner reads this."],
            });
        }
        if (reason.Length > 1000)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["reason"] = ["Keep it under 1000 characters."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var staged = await LockStaged(conn, tx, listingId, ct);
        if (staged is null)
        {
            return Results.NotFound();
        }

        await PendingChanges.RejectAsync(conn, tx, staged.Id, admin.Id, reason, ct);
        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.changes_rejected", "listing",
            listingId.ToString(System.Globalization.CultureInfo.InvariantCulture), http,
            new { reason }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    /// <summary>
    /// Reads the staged edit and holds it for the rest of the transaction, so two decisions on the
    /// same edit cannot interleave.
    /// </summary>
    private static async Task<PendingChanges.Staged?> LockStaged(
        SqlConnection conn, SqlTransaction tx, long listingId, CancellationToken ct)
    {
        await using (var lockRow = new SqlCommand(
            @"SELECT TOP (1) 1 FROM dbo.listing_pending_changes WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE listing_id = @listing", conn, tx))
        {
            lockRow.Parameters.AddWithValue("listing", listingId);
            if (await lockRow.ExecuteScalarAsync(ct) is null)
            {
                return null;
            }
        }

        return await PendingChanges.ForListingAsync(conn, tx, listingId, ct);
    }
}
