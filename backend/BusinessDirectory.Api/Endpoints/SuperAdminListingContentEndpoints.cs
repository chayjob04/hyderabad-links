using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Staff editing a listing's own written content, under
/// /api/v1/super-admin/listings/{id}/{faqs,content,links} — the original's `Super/EditListingFaqs`,
/// `Super/EditListingContent` and `Super/EditSocialLinks`.
///
/// Why this exists at all, when the owner already has these screens: a great many listings on a
/// directory like this are added by staff for a business that walked in, phoned, or sent a
/// WhatsApp, and that business has no account to log into. Without this, the only way to write an
/// About section for them is to create an account in their name, which is worse in every respect.
///
/// Three things are deliberately the same as the owner's version:
///
///   **The plan allowance is enforced.** Staff cannot add a fifth FAQ to a listing whose plan
///   allows four. The temptation is to let staff past it — they are trusted — but the public views
///   (`listing_visible_faqs`, S0020) would simply hide the extra, so the only thing a bypass buys
///   is a staff member who believes they have published something that nobody can see.
///
///   **The count is taken inside the transaction, with the listing locked.** Same reasoning as
///   OwnerListingContentEndpoints: two requests arriving together must not both find room for the
///   last slot.
///
///   **Nothing is deleted to make room.** Over-allowance rows are kept and hidden (D10).
///
/// What differs is the gate. There is no ownership check — a super admin acts on any listing — and
/// the permission is <c>listings.edit</c>, the same one that already allows correcting a listing's
/// phone number. Writing its About section is not a larger power than that. Every change is
/// recorded in the audit log with the admin's id, which is the real control here: an owner can see
/// their own edits, and a staff edit to someone else's listing should be answerable to a name.
/// </summary>
public static class SuperAdminListingContentEndpoints
{
    public static RouteGroupBuilder MapSuperAdminListingContentEndpoints(this RouteGroupBuilder listings)
    {
        listings.MapGet("/{id:long}/faqs", ListFaqs);
        listings.MapPost("/{id:long}/faqs", AddFaq);
        listings.MapDelete("/{id:long}/faqs/{faqId:long}", DeleteFaq);

        listings.MapGet("/{id:long}/content", ListContent);
        listings.MapPost("/{id:long}/content", AddContent);
        listings.MapDelete("/{id:long}/content/{sectionId:long}", DeleteContent);

        listings.MapGet("/{id:long}/links", ListLinks);
        listings.MapPost("/{id:long}/links", AddLink);
        listings.MapDelete("/{id:long}/links/{linkId:long}", DeleteLink);

        return listings;
    }

    /// <summary>What the listing's current plan allows, and what it is called, for the refusals.</summary>
    private sealed record Allowance(int FaqLimit, int ContentLimit, int LinkLimit, string PlanName);

    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return (null, Results.Unauthorized());
        }
        return (admin, AdminAccess.AuthorizeSuper(admin, AdminPermissions.ListingsEdit));
    }

    /// <summary>
    /// The allowance, with the listing row locked when called inside a transaction. No
    /// business_members join: that join is what makes the owner's version an ownership check, and
    /// there is nothing to check here.
    /// </summary>
    private static async Task<Allowance?> ReadAllowance(
        SqlConnection conn, SqlTransaction? tx, long listingId, CancellationToken ct)
    {
        var lockHint = tx is null ? string.Empty : " WITH (UPDLOCK, ROWLOCK)";
        await using var command = new SqlCommand(
            $@"SELECT e.faq_limit, e.content_section_limit, e.link_limit, e.effective_plan_name
               FROM dbo.listings li{lockHint}
               JOIN dbo.listing_entitlements e ON e.listing_id = li.id
               WHERE li.id = @listing", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct)
            ? new Allowance(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetString(3))
            : null;
    }

    private static async Task<int> CountAsync(
        SqlConnection conn, SqlTransaction tx, string table, long listingId, CancellationToken ct)
    {
        // The table name is a compile-time constant from this file, never user input.
        await using var command = new SqlCommand(
            $"SELECT COUNT_BIG(*) FROM {table} WHERE listing_id = @listing", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);
        return (int)(long)(await command.ExecuteScalarAsync(ct))!;
    }

    /// <summary>
    /// The refusal when a listing is already at its allowance. Says what the plan allows, so a staff
    /// member learns the reason rather than being told "no".
    /// </summary>
    private static IResult OverAllowance(string planName, int limit, string what) =>
        Results.Problem(
            limit == 0
                ? $"The {planName} plan does not include {what}."
                : $"The {planName} plan allows {limit} {what}. Remove one first.",
            statusCode: StatusCodes.Status409Conflict);

    // ---- FAQs ----------------------------------------------------------------------------------

    private static async Task<IResult> ListFaqs(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var allowance = await ReadAllowance(conn, null, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        /* Every row, including any over the allowance. This is the editing screen: a hidden row is
           exactly what a staff member needs to see to understand why the public page looks short. */
        await using var command = new SqlCommand(
            @"SELECT id, question, answer, sort_order FROM dbo.listing_faqs
              WHERE listing_id = @listing ORDER BY sort_order, id", conn);
        command.Parameters.AddWithValue("listing", id);

        var items = new List<OwnerListingContentEndpoints.FaqDto>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                items.Add(new OwnerListingContentEndpoints.FaqDto(
                    reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3)));
            }
        }

        return Results.Ok(new OwnerListingContentEndpoints.CollectionDto<OwnerListingContentEndpoints.FaqDto>(
            items, allowance.FaqLimit, items.Count, allowance.PlanName));
    }

    private static async Task<IResult> AddFaq(
        long id,
        OwnerListingContentEndpoints.FaqRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var question = request.Question?.Trim() ?? string.Empty;
        var answer = request.Answer?.Trim() ?? string.Empty;
        // The owner's validator, deliberately: one set of length rules, so the two screens cannot
        // disagree about what fits in the column.
        if (OwnerListingContentEndpoints.Validate(
                question, "question", OwnerListingContentEndpoints.MaxQuestionLength,
                answer, "answer", OwnerListingContentEndpoints.MaxAnswerLength) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        var allowance = await ReadAllowance(conn, tx, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        var used = await CountAsync(conn, tx, "dbo.listing_faqs", id, ct);
        if (used >= allowance.FaqLimit)
        {
            return OverAllowance(allowance.PlanName, allowance.FaqLimit, "FAQs");
        }

        await using var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_faqs (listing_id, question, answer, sort_order)
              OUTPUT INSERTED.id
              VALUES (@listing, @question, @answer, @sort)", conn, tx);
        insert.Parameters.AddWithValue("listing", id);
        insert.Parameters.AddWithValue("question", question);
        insert.Parameters.AddWithValue("answer", answer);
        insert.Parameters.AddWithValue("sort", request.SortOrder ?? used);
        var newId = (long)(await insert.ExecuteScalarAsync(ct))!;

        /* The question, not the answer, in the audit detail: it names what was added without
           copying a paragraph into the log, and the row itself is still there to read. */
        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "listing.faq.created", "listing", id.ToString(), http,
            new { faqId = newId, question }, ct);

        await tx.CommitAsync(ct);
        return Results.Created(
            $"/api/v1/super-admin/listings/{id}/faqs/{newId}",
            new OwnerListingContentEndpoints.FaqDto(newId, question, answer, request.SortOrder ?? used));
    }

    private static async Task<IResult> DeleteFaq(
        long id, long faqId, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        await DeleteRow(id, faqId, "dbo.listing_faqs", "listing.faq.deleted", principal, http, db, ct);

    // ---- content sections ----------------------------------------------------------------------

    private static async Task<IResult> ListContent(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var allowance = await ReadAllowance(conn, null, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        await using var command = new SqlCommand(
            @"SELECT id, heading, body, sort_order FROM dbo.listing_content_sections
              WHERE listing_id = @listing ORDER BY sort_order, id", conn);
        command.Parameters.AddWithValue("listing", id);

        var items = new List<OwnerListingContentEndpoints.ContentDto>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                items.Add(new OwnerListingContentEndpoints.ContentDto(
                    reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3)));
            }
        }

        return Results.Ok(new OwnerListingContentEndpoints.CollectionDto<OwnerListingContentEndpoints.ContentDto>(
            items, allowance.ContentLimit, items.Count, allowance.PlanName));
    }

    private static async Task<IResult> AddContent(
        long id,
        OwnerListingContentEndpoints.ContentRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var heading = request.Heading?.Trim() ?? string.Empty;
        var body = request.Body?.Trim() ?? string.Empty;
        if (OwnerListingContentEndpoints.Validate(
                heading, "heading", OwnerListingContentEndpoints.MaxHeadingLength,
                body, "body", OwnerListingContentEndpoints.MaxBodyLength) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        var allowance = await ReadAllowance(conn, tx, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        var used = await CountAsync(conn, tx, "dbo.listing_content_sections", id, ct);
        if (used >= allowance.ContentLimit)
        {
            return OverAllowance(allowance.PlanName, allowance.ContentLimit, "description sections");
        }

        await using var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_content_sections (listing_id, heading, body, sort_order)
              OUTPUT INSERTED.id
              VALUES (@listing, @heading, @body, @sort)", conn, tx);
        insert.Parameters.AddWithValue("listing", id);
        insert.Parameters.AddWithValue("heading", heading);
        insert.Parameters.AddWithValue("body", body);
        insert.Parameters.AddWithValue("sort", request.SortOrder ?? used);
        var newId = (long)(await insert.ExecuteScalarAsync(ct))!;

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "listing.content.created", "listing", id.ToString(), http,
            new { sectionId = newId, heading }, ct);

        await tx.CommitAsync(ct);
        return Results.Created(
            $"/api/v1/super-admin/listings/{id}/content/{newId}",
            new OwnerListingContentEndpoints.ContentDto(newId, heading, body, request.SortOrder ?? used));
    }

    private static async Task<IResult> DeleteContent(
        long id, long sectionId, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        await DeleteRow(id, sectionId, "dbo.listing_content_sections", "listing.content.deleted", principal, http, db, ct);

    // ---- website and social links --------------------------------------------------------------

    private static async Task<IResult> ListLinks(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var allowance = await ReadAllowance(conn, null, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        await using var command = new SqlCommand(
            @"SELECT id, link_type, label, url, sort_order FROM dbo.listing_links
              WHERE listing_id = @listing ORDER BY sort_order, id", conn);
        command.Parameters.AddWithValue("listing", id);

        var items = new List<OwnerLinkEndpoints.LinkDto>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                items.Add(new OwnerLinkEndpoints.LinkDto(
                    reader.GetInt64(0), reader.GetString(1), reader.GetString(2),
                    reader.GetString(3), reader.GetInt32(4)));
            }
        }

        return Results.Ok(new OwnerListingContentEndpoints.CollectionDto<OwnerLinkEndpoints.LinkDto>(
            items, allowance.LinkLimit, items.Count, allowance.PlanName));
    }

    private static async Task<IResult> AddLink(
        long id,
        OwnerLinkEndpoints.AddLinkRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        /* The owner's own validator. It is the piece that decides what a link may point at, and a
           second implementation here is how one of the two ends up accepting a `javascript:` URL. */
        if (!OwnerLinkEndpoints.TryNormalise(request, out var link, out var errors))
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        var allowance = await ReadAllowance(conn, tx, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        /* The lowest free slot, not the row count. `listing_links` has a unique index on
           (listing_id, sort_order) up to the allowance, so a link removed from the middle leaves a
           gap that a plain count would collide with. Same allocator the owner's screen uses. */
        var slot = await OwnerLinkEndpoints.NextFreeSlot(conn, tx, id, allowance.LinkLimit, ct);
        if (slot is null)
        {
            return OverAllowance(allowance.PlanName, allowance.LinkLimit, "website and social links");
        }

        await using var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
              OUTPUT INSERTED.id
              VALUES (@listing, @type, @label, @url, @slot)", conn, tx);
        insert.Parameters.AddWithValue("listing", id);
        insert.Parameters.AddWithValue("type", link.LinkType);
        insert.Parameters.AddWithValue("label", link.Label);
        insert.Parameters.AddWithValue("url", link.Url);
        insert.Parameters.AddWithValue("slot", slot.Value);
        var newId = (long)(await insert.ExecuteScalarAsync(ct))!;

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "listing.link.created", "listing", id.ToString(), http,
            new { linkId = newId, linkType = link.LinkType, url = link.Url }, ct);

        await tx.CommitAsync(ct);
        return Results.Created(
            $"/api/v1/super-admin/listings/{id}/links/{newId}",
            new OwnerLinkEndpoints.LinkDto(newId, link.LinkType, link.Label, link.Url, slot.Value));
    }

    private static async Task<IResult> DeleteLink(
        long id, long linkId, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        await DeleteRow(id, linkId, "dbo.listing_links", "listing.link.deleted", principal, http, db, ct);

    // ---- one delete, three tables --------------------------------------------------------------

    /// <summary>
    /// Removes one row from one of the three tables above.
    ///
    /// The `listing_id = @listing` in the WHERE is not decoration: without it, a row id from one
    /// listing would delete from another, and the route would be a way to vandalise any listing by
    /// guessing ids. The table name is a constant from this file, never user input.
    /// </summary>
    private static async Task<IResult> DeleteRow(
        long listingId,
        long rowId,
        string table,
        string action,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        await using var command = new SqlCommand(
            $@"DELETE FROM {table} WHERE id = @row AND listing_id = @listing;
               SELECT @@ROWCOUNT;", conn, tx);
        command.Parameters.AddWithValue("row", rowId);
        command.Parameters.AddWithValue("listing", listingId);

        var changed = (int)(await command.ExecuteScalarAsync(ct) ?? 0);
        if (changed == 0)
        {
            return Results.NotFound();
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, action, "listing", listingId.ToString(), http, new { rowId }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }
}
