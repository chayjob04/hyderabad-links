using System.Data;
using System.Globalization;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using BusinessDirectory.Api.Media;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Edits to listings that are already published — /api/v1/admin/listing-changes.
///
/// A listing that has never been published is reviewed as a whole in the moderation queue:
/// approving it puts it on the site. An edit to a listing that is already on the site cannot work
/// that way, because taking a live business down while somebody reads a changed phone number is a
/// worse answer than either outcome. So the owner edits a complete staged copy of the listing
/// (S0034) and this is where the two versions are compared and one decision is taken about all of
/// it.
///
/// <b>All five sections.</b> The staged copy has its own photos, opening hours, questions, content
/// sections, amenities and links, so every one of them is compared here and every one of them is
/// published together or not at all. Nothing an owner changes about a published listing reaches the
/// public page before this screen says so.
///
/// Same permission as the listing queue, <c>listings.review</c>: it is the same judgement about the
/// same kind of content.
/// </summary>
public static class AdminPendingChangeEndpoints
{
    public sealed record RejectRequest(string? Reason);

    /// <param name="FieldsChanged">How many of the detail fields differ from what is published.</param>
    /// <param name="SectionsChanged">How many of the five sections have any difference at all.</param>
    public sealed record QueueItemDto(
        long ListingId,
        string ListingName,
        string ListingStatus,
        string LocalityName,
        string Status,
        DateTimeOffset? SubmittedAt,
        DateTimeOffset UpdatedAt,
        int FieldsChanged,
        int SectionsChanged = 0);

    /// <summary>One field, as published and as proposed. `Changed` is what the screen highlights.</summary>
    public sealed record FieldComparisonDto(string Field, string Label, string? Current, string? Proposed, bool Changed);

    /// <param name="State">`same`, `added`, `removed` or `moved`.</param>
    public sealed record SectionItemDto(string Label, string? Detail, string State);

    /// <param name="Changes">Items added, removed or moved. Zero means this section is untouched.</param>
    public sealed record SectionComparisonDto(
        string Section,
        string Label,
        int Changes,
        IReadOnlyList<SectionItemDto> Items);

    public sealed record ComparisonDto(
        long ListingId,
        string ListingName,
        string ListingStatus,
        string? Url,
        string Status,
        DateTimeOffset? SubmittedAt,
        string? ReviewNote,
        IReadOnlyList<FieldComparisonDto> Fields,
        IReadOnlyList<SectionComparisonDto> Sections);

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
    /// What is waiting. Submitted edits by default — a draft is private to its owner and a rejected
    /// one is theirs to fix, so neither belongs in somebody's work queue.
    /// </summary>
    /// <param name="status">
    /// `pending_review` (the default), `rejected`, `draft`, or `all` to see everything staged, which
    /// is how a moderator checks whether their note was acted on.
    /// </param>
    private static async Task<IResult> Queue(
        string? status, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var wanted = string.IsNullOrWhiteSpace(status) ? "pending_review" : status.Trim().ToLowerInvariant();
        if (wanted is not ("all" or "pending_review" or "rejected" or "draft"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["status"] = ["Expected pending_review, rejected, draft or all."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            /* One row per staged listing, joined to the listing it stands in for. The counts are
               worked out in SQL so a moderator triaging twenty edits can see which is a rewrite and
               which is a corrected digit without loading either version.

               NULL-safe comparison on both sides of every field: clearing a field is a change, and
               `<>` would miss it. The section counts are "does this section differ at all", by
               comparing each side's row count and then its contents through EXCEPT -- which is the
               cheapest way to ask that question of a handful of rows. */
            @"SELECT s.staged_for_listing_id, li.name, li.status, lo.name AS locality_name,
                     s.status, s.updated_at,
                     (CASE WHEN ISNULL(s.name, N'')          <> ISNULL(li.name, N'')          THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(s.description, N'')   <> ISNULL(li.description, N'')   THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(s.address_line, N'')  <> ISNULL(li.address_line, N'')  THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(s.pincode, N'')       <> ISNULL(li.pincode, N'')       THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(s.phone_primary, '')  <> ISNULL(li.phone_primary, '')  THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(s.phone_whatsapp, '') <> ISNULL(li.phone_whatsapp, '') THEN 1 ELSE 0 END
                    + CASE WHEN ISNULL(s.website_url, N'')   <> ISNULL(li.website_url, N'')   THEN 1 ELSE 0 END
                     ) AS fields_changed,
                     (CASE WHEN EXISTS (
                          SELECT kind, storage_key, sort_order FROM dbo.listing_media WHERE listing_id = s.id
                          EXCEPT
                          SELECT kind, storage_key, sort_order FROM dbo.listing_media WHERE listing_id = li.id)
                        OR EXISTS (
                          SELECT kind, storage_key, sort_order FROM dbo.listing_media WHERE listing_id = li.id
                          EXCEPT
                          SELECT kind, storage_key, sort_order FROM dbo.listing_media WHERE listing_id = s.id)
                      THEN 1 ELSE 0 END
                    + CASE WHEN EXISTS (
                          SELECT day_of_week, opens_at, closes_at FROM dbo.listing_opening_hours WHERE listing_id = s.id
                          EXCEPT
                          SELECT day_of_week, opens_at, closes_at FROM dbo.listing_opening_hours WHERE listing_id = li.id)
                        OR EXISTS (
                          SELECT day_of_week, opens_at, closes_at FROM dbo.listing_opening_hours WHERE listing_id = li.id
                          EXCEPT
                          SELECT day_of_week, opens_at, closes_at FROM dbo.listing_opening_hours WHERE listing_id = s.id)
                      THEN 1 ELSE 0 END
                    + CASE WHEN EXISTS (
                          SELECT question, answer FROM dbo.listing_faqs WHERE listing_id = s.id
                          EXCEPT
                          SELECT question, answer FROM dbo.listing_faqs WHERE listing_id = li.id)
                        OR EXISTS (
                          SELECT question, answer FROM dbo.listing_faqs WHERE listing_id = li.id
                          EXCEPT
                          SELECT question, answer FROM dbo.listing_faqs WHERE listing_id = s.id)
                        OR EXISTS (
                          SELECT heading, body FROM dbo.listing_content_sections WHERE listing_id = s.id
                          EXCEPT
                          SELECT heading, body FROM dbo.listing_content_sections WHERE listing_id = li.id)
                        OR EXISTS (
                          SELECT heading, body FROM dbo.listing_content_sections WHERE listing_id = li.id
                          EXCEPT
                          SELECT heading, body FROM dbo.listing_content_sections WHERE listing_id = s.id)
                        OR EXISTS (
                          SELECT kind, label FROM dbo.listing_attributes WHERE listing_id = s.id
                          EXCEPT
                          SELECT kind, label FROM dbo.listing_attributes WHERE listing_id = li.id)
                        OR EXISTS (
                          SELECT kind, label FROM dbo.listing_attributes WHERE listing_id = li.id
                          EXCEPT
                          SELECT kind, label FROM dbo.listing_attributes WHERE listing_id = s.id)
                      THEN 1 ELSE 0 END
                    + CASE WHEN EXISTS (
                          SELECT link_type, label, url FROM dbo.listing_links WHERE listing_id = s.id
                          EXCEPT
                          SELECT link_type, label, url FROM dbo.listing_links WHERE listing_id = li.id)
                        OR EXISTS (
                          SELECT link_type, label, url FROM dbo.listing_links WHERE listing_id = li.id
                          EXCEPT
                          SELECT link_type, label, url FROM dbo.listing_links WHERE listing_id = s.id)
                      THEN 1 ELSE 0 END
                     ) AS sections_changed
              FROM dbo.listings s
              JOIN dbo.listings li ON li.id = s.staged_for_listing_id
              JOIN dbo.localities lo ON lo.id = li.locality_id
              WHERE s.staged_for_listing_id IS NOT NULL
                AND (@status = 'all' OR s.status = @status)
              ORDER BY CASE WHEN s.status = 'pending_review' THEN 0 ELSE 1 END,
                       s.updated_at ASC", conn);
        command.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar) { Value = wanted });

        var items = new List<QueueItemDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var updatedAt = reader.GetFieldValue<DateTimeOffset>(5);
            items.Add(new QueueItemDto(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                /* A staged listing's `updated_at` is when it was last touched, which for a
                   submitted one is when it was submitted: the owner's submit is the write. */
                reader.GetString(4) == "pending_review" ? updatedAt : null,
                updatedAt,
                reader.GetInt32(6),
                reader.GetInt32(7)));
        }

        return Results.Ok(items);
    }

    /// <summary>
    /// The published version beside the proposed one: the detail fields, then all five sections.
    /// </summary>
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
        long stagedId;
        ComparisonDto head;

        await using (var command = new SqlCommand(
            @"SELECT s.id, li.name, li.status, li.description, li.address_line, li.pincode,
                     li.phone_primary, li.phone_whatsapp, li.website_url,
                     pc.name AS category_name, pcparent.slug AS parent_category_slug, pc.slug AS category_slug,
                     li.slug,
                     s.status, s.updated_at, s.review_note,
                     s.name, s.description, s.address_line, s.pincode,
                     s.phone_primary, s.phone_whatsapp, s.website_url,
                     sc.name AS staged_category_name
              FROM dbo.listings s
              JOIN dbo.listings li ON li.id = s.staged_for_listing_id
              LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              LEFT JOIN dbo.categories pc ON pc.id = lc.category_id
              LEFT JOIN dbo.categories pcparent ON pcparent.id = pc.parent_id
              LEFT JOIN dbo.listing_categories slc ON slc.listing_id = s.id AND slc.is_primary = 1
              LEFT JOIN dbo.categories sc ON sc.id = slc.category_id
              WHERE s.staged_for_listing_id = @listing", conn, tx))
        {
            command.Parameters.AddWithValue("listing", listingId);

            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return null;
            }

            string? Text(int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
            stagedId = reader.GetInt64(0);

            var fields = new List<FieldComparisonDto>
            {
                Field("name", "Business name", Text(1), Text(16)),
                Field("categoryName", "Category", Text(9), Text(23)),
                Field("addressLine", "Address", Text(4), Text(18)),
                Field("pincode", "Pincode", Text(5), Text(19)),
                Field("phonePrimary", "Phone", Text(6), Text(20)),
                Field("phoneWhatsapp", "WhatsApp", Text(7), Text(21)),
                Field("websiteUrl", "Website", Text(8), Text(22)),
                Field("description", "Description", Text(3), Text(17)),
            };

            head = new ComparisonDto(
                listingId,
                reader.GetString(1),
                reader.GetString(2),
                PublicUrl.ForListing(Text(10), Text(11), reader.GetString(12)),
                reader.GetString(13),
                reader.GetString(13) == "pending_review" ? reader.GetFieldValue<DateTimeOffset>(14) : null,
                Text(15),
                fields,
                []);
        }

        var sections = new List<SectionComparisonDto>
        {
            await SectionAsync(conn, tx, listingId, stagedId, "media",
                @"SELECT kind + ' ' + CAST(sort_order + 1 AS varchar(10)) AS label,
                         storage_key AS detail, kind + '|' + storage_key AS item_key,
                         CAST(sort_order AS varchar(10)) AS position
                  FROM dbo.listing_media WHERE listing_id = @id", ct),

            await SectionAsync(conn, tx, listingId, stagedId, "hours",
                @"SELECT CASE day_of_week WHEN 0 THEN 'Monday' WHEN 1 THEN 'Tuesday' WHEN 2 THEN 'Wednesday'
                              WHEN 3 THEN 'Thursday' WHEN 4 THEN 'Friday' WHEN 5 THEN 'Saturday'
                              ELSE 'Sunday' END AS label,
                         CONVERT(varchar(5), opens_at, 108) + ' to ' + CONVERT(varchar(5), closes_at, 108) AS detail,
                         CAST(day_of_week AS varchar(2)) + '|' + CONVERT(varchar(5), opens_at, 108)
                             + '|' + CONVERT(varchar(5), closes_at, 108) AS item_key,
                         '' AS position
                  FROM dbo.listing_opening_hours WHERE listing_id = @id", ct),

            await SectionAsync(conn, tx, listingId, stagedId, "about",
                @"SELECT question AS label, answer AS detail, N'faq|' + question + N'|' + answer AS item_key, '' AS position
                  FROM dbo.listing_faqs WHERE listing_id = @id
                  UNION ALL
                  SELECT heading, body, N'content|' + heading + N'|' + body, ''
                  FROM dbo.listing_content_sections WHERE listing_id = @id
                  UNION ALL
                  SELECT kind + N': ' + label, NULL, N'attr|' + kind + N'|' + label, ''
                  FROM dbo.listing_attributes WHERE listing_id = @id", ct),

            await SectionAsync(conn, tx, listingId, stagedId, "links",
                @"SELECT label, url, link_type + N'|' + label + N'|' + url AS item_key, '' AS position
                  FROM dbo.listing_links WHERE listing_id = @id", ct),
        };

        return head with { Sections = sections };
    }

    /// <summary>
    /// One section, compared item by item.
    /// </summary>
    /// <remarks>
    /// Both sides are read with the same query against two listing ids, which is the point: the
    /// published version and the proposed one are the same shape of thing, so there is one SQL
    /// statement per section rather than two that could drift.
    ///
    /// An item is matched on <c>item_key</c> -- what the thing *is*, rather than its row id, because
    /// the staged copy's rows are copies with their own ids. So an untouched photo is `same`, one the
    /// owner added is `added`, one they removed is `removed`, and one that is in both but at a
    /// different position is `moved`. That last one matters for photos: the first photo is the one
    /// that appears in search results.
    /// </remarks>
    private static async Task<SectionComparisonDto> SectionAsync(
        SqlConnection conn,
        SqlTransaction? tx,
        long publishedId,
        long stagedId,
        string section,
        string sql,
        CancellationToken ct)
    {
        var published = await ItemsAsync(conn, tx, sql, publishedId, ct);
        var staged = await ItemsAsync(conn, tx, sql, stagedId, ct);

        var items = new List<SectionItemDto>();
        var changes = 0;

        foreach (var item in staged.Values)
        {
            if (!published.TryGetValue(item.Key, out var before))
            {
                items.Add(new SectionItemDto(item.Label, item.Detail, "added"));
                changes++;
            }
            else if (!string.Equals(before.Position, item.Position, StringComparison.Ordinal))
            {
                items.Add(new SectionItemDto(item.Label, item.Detail, "moved"));
                changes++;
            }
            else
            {
                items.Add(new SectionItemDto(item.Label, item.Detail, "same"));
            }
        }

        foreach (var item in published.Values)
        {
            if (!staged.ContainsKey(item.Key))
            {
                /* Shown, and shown as removed: a moderator deciding whether to publish an edit has
                   to see what would stop being there. An approval that quietly dropped six photos
                   would be indistinguishable from one that changed a phone number. */
                items.Add(new SectionItemDto(item.Label, item.Detail, "removed"));
                changes++;
            }
        }

        return new SectionComparisonDto(section, SectionLabel(section), changes, items);
    }

    private static string SectionLabel(string section) => section switch
    {
        "media" => "Photos and video",
        "hours" => "Opening hours",
        "about" => "About, questions and amenities",
        "links" => "Website and social links",
        _ => section,
    };

    private sealed record Item(string Key, string Label, string? Detail, string Position);

    private static async Task<Dictionary<string, Item>> ItemsAsync(
        SqlConnection conn, SqlTransaction? tx, string sql, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(sql, conn, tx);
        command.Parameters.AddWithValue("id", listingId);

        var items = new Dictionary<string, Item>(StringComparer.Ordinal);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var label = reader.GetString(0);
            var detail = reader.IsDBNull(1) ? null : reader.GetString(1);
            var key = reader.GetString(2);
            var position = reader.GetString(3);
            // Two identical items in one section are one item to a reader; the key collapses them.
            items[key] = new Item(key, label, detail, position);
        }
        return items;
    }

    /// <summary>
    /// One row of the field comparison. Blank and null are the same thing to a reader, so they are
    /// the same thing here: an owner who clears a field and one who never filled it in have both
    /// left it empty, and that is not a change worth highlighting.
    /// </summary>
    private static FieldComparisonDto Field(string field, string label, string? current, string? proposed) =>
        new(field, label, current, proposed,
            !string.Equals(current?.Trim() ?? "", proposed?.Trim() ?? "", StringComparison.Ordinal));

    /// <summary>
    /// Publishes the staged listing: every section at once.
    /// </summary>
    /// <remarks>
    /// One transaction over eight tables (see <c>StagedListings.ApproveAsync</c>): the published
    /// listing's children are deleted, the staged listing's are moved onto it, its values are
    /// copied, and the staged row is deleted. A half-applied approval would publish a name without
    /// its photos, which is why none of it is done in pieces.
    ///
    /// Files whose last row disappeared in the process are deleted after the commit, never before: a
    /// rolled-back approval that had already removed a photo would have destroyed something it did
    /// not publish.
    ///
    /// The staged row is locked as it is read, so two moderators pressing Approve at the same moment
    /// queue rather than both applying it -- the second finds nothing staged and is told so.
    /// </remarks>
    private static async Task<IResult> Approve(
        long listingId,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        IMediaStorage storage,
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

        if (staged.Status == "draft")
        {
            /* Not submitted. The owner is still working on it, and approving something nobody has
               asked to be looked at would publish text they had not finished. */
            return Results.Problem(
                "These changes have not been submitted for review yet.",
                statusCode: StatusCodes.Status409Conflict);
        }

        /* The same rule a new listing is held to: an address and a description of twenty characters.
           A staged edit could not have been submitted without them, but a moderator approving one
           that somehow lacks them would publish a listing the review queue would have refused. */
        var missing = await ReadinessAsync(conn, tx, staged.ListingId, ct);
        if (missing.Count > 0)
        {
            return Results.ValidationProblem(missing);
        }

        var orphaned = await StagedListings.ApproveAsync(
            conn, tx, staged.ListingId, listingId, admin.Id, ct);

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.changes_approved", "listing",
            listingId.ToString(CultureInfo.InvariantCulture), http,
            new { stagedListingId = staged.ListingId, filesReleased = orphaned.Count }, ct);
        await tx.CommitAsync(ct);

        foreach (var key in orphaned)
        {
            if (storage.IsConfigured)
            {
                await storage.DeleteAsync(key, CancellationToken.None);
            }
        }

        return Results.NoContent();
    }

    /// <summary>
    /// Refuses the staged listing and keeps it, so its owner carries on from their own work.
    /// </summary>
    /// <remarks>
    /// The published listing is not touched: not its values, not its photos, not its hours, not its
    /// status. That is the half of this feature that is easy to get wrong and impossible to notice —
    /// a refusal that touched the live page would mean a moderator saying "no" had published
    /// something.
    /// </remarks>
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

        await StagedListings.RejectAsync(conn, tx, staged.ListingId, admin.Id, reason, ct);
        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.changes_rejected", "listing",
            listingId.ToString(CultureInfo.InvariantCulture), http,
            new { stagedListingId = staged.ListingId, reason }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    /// <summary>What a staged listing would still be missing if it were published.</summary>
    private static async Task<Dictionary<string, string[]>> ReadinessAsync(
        SqlConnection conn, SqlTransaction tx, long stagedId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "SELECT address_line, description FROM dbo.listings WHERE id = @id", conn, tx);
        command.Parameters.AddWithValue("id", stagedId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return [];
        }

        return ListingReadiness.MissingForReview(
            reader.IsDBNull(0) ? null : reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetString(1));
    }

    /// <summary>
    /// Reads the staged listing and holds it for the rest of the transaction, so two decisions on
    /// the same edit cannot interleave.
    /// </summary>
    private static async Task<StagedListings.Staged?> LockStaged(
        SqlConnection conn, SqlTransaction tx, long listingId, CancellationToken ct)
    {
        await using (var lockRow = new SqlCommand(
            @"SELECT TOP (1) 1 FROM dbo.listings WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE staged_for_listing_id = @listing", conn, tx))
        {
            lockRow.Parameters.AddWithValue("listing", listingId);
            if (await lockRow.ExecuteScalarAsync(ct) is null)
            {
                return null;
            }
        }

        return await StagedListings.ForListingAsync(conn, tx, listingId, ct);
    }
}
