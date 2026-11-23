using BusinessDirectory.Api.Data;
using System.Data;
using System.Net;
using System.Security.Claims;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// A signed-in owner's own listings, under /api/v1/me/listings. Raw parameterised SQL, no ORM.
/// Every query is scoped to the caller through business_members, so another owner's listing looks like "not found".
/// Save Changes and Submit are different acts. Saving stores the work and leaves the listing
/// where it is -- a draft stays a draft, a rejection stays a rejection -- so an owner can build a
/// listing across several sittings. Submit is what puts it in front of a reviewer, and it refuses
/// an incomplete listing with the missing fields named.
///
/// Editing a listing that is already public is the exception: that goes back through review on
/// save, because the alternative is an approved listing being rewritten afterwards without a
/// reviewer seeing it.
/// </summary>
public static class OwnerListingEndpoints
{
    public const int MaxListingsPerOwner = 5;

    public sealed record OwnerListingDto(
        long Id,
        string Slug,
        string Name,
        string? Description,
        string? AddressLine,
        string? Pincode,
        string PhonePrimary,
        string? PhoneWhatsapp,
        string? WebsiteUrl,
        double Latitude,
        double Longitude,
        string CitySlug,
        string LocalitySlug,
        string LocalityName,
        string CategorySlug,
        string CategoryName,
        string Status,
        /// <summary>Why a reviewer rejected the listing. The owner reads this and fixes it.</summary>
        string? ReviewNote,
        DateTimeOffset? ReviewedAt,
        string Url,

        /* The plan this one listing is on, so "My listings" can show it per card. Each listing is
           bought for separately -- a user with three businesses can pay for two and leave the third
           Free -- so a plan on the account would be the wrong shape entirely. It comes from
           listing_entitlements, which works the period out against the clock at read time, so a
           lapsed listing reads as Free with nothing having to run. */
        string PlanSlug,
        string PlanName,
        bool Verified,
        DateTimeOffset? PaidUntil,

        /// <summary>Unacknowledged staff requests to fix something (S0017). The card shows a flag per listing.</summary>
        int OpenAlerts,

        /// <summary>
        /// The owner's edit to this published listing, waiting to go live (S0031). Null when there
        /// is none, which is every listing that has never been edited after publication.
        ///
        /// The fields above are what the public sees; these are what the owner last typed. The
        /// editor shows these, so an owner carries on from their own draft rather than from the
        /// approved text, and the screen says which is which.
        /// </summary>
        PendingChangeDto? PendingChanges = null);

    /// <param name="Status">draft (private), pending_review (in the queue) or rejected (with a note).</param>
    public sealed record PendingChangeDto(
        string Status,
        string? Name,
        string? Description,
        string? AddressLine,
        string? Pincode,
        string? PhonePrimary,
        string? PhoneWhatsapp,
        string? WebsiteUrl,
        string? CategorySlug,
        string? CategoryName,
        string? ReviewNote,
        DateTimeOffset? SubmittedAt,
        DateTimeOffset? ReviewedAt,
        DateTimeOffset UpdatedAt);

    private const string OwnedListingSelect =
        @"SELECT li.id, li.slug, li.name, li.description, li.address_line, li.pincode, li.phone_primary, li.phone_whatsapp,
                 li.website_url, li.location.Lat, li.location.Long,
                 ci.slug, lo.slug, lo.name, pc.slug, pc.name, li.status, li.review_note, li.reviewed_at,
                 -- Appended rather than placed where they belong logically: this result set is read
                 -- by position, so inserting a column in the middle silently shifts every index
                 -- after it. New columns go on the end.
                 pcparent.slug AS parent_category_slug,
                 e.effective_plan_slug, e.effective_plan_name, e.is_verified, e.paid_until,
                 (SELECT COUNT_BIG(*) FROM dbo.listing_alerts a
                  WHERE a.listing_id = li.id AND a.acknowledged_at IS NULL) AS open_alerts
          FROM dbo.listings li
          JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
          JOIN dbo.listing_entitlements e ON e.listing_id = li.id
          JOIN dbo.localities lo ON lo.id = li.locality_id
          JOIN dbo.cities ci ON ci.id = lo.city_id
          JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
          JOIN dbo.categories pc ON pc.id = lc.category_id
          -- A public path is /parent/category/slug, so the parent travels with every listing.
          JOIN dbo.categories pcparent ON pcparent.id = pc.parent_id
          WHERE li.status <> 'archived'";

    public static RouteGroupBuilder MapOwnerListingEndpoints(this RouteGroupBuilder me)
    {
        var group = me.MapGroup("/listings");
        group.MapGet("", List);
        group.MapPost("", Create);
        group.MapGet("/{id:long}", Get);
        group.MapPut("/{id:long}", Update);
        group.MapPost("/{id:long}/submit", Submit);
        /* Throwing away an edit that has not gone live, so the owner sees the published version
           again. Theirs to discard: it is their text and nothing public depends on it. */
        group.MapDelete("/{id:long}/pending-changes", DiscardPendingChanges);
        group.MapOwnerMediaEndpoints();   // photos, logo and video, with the plan allowance enforced
        group.MapOwnerLinkEndpoints();    // website and social links, capped by the plan's allowance
        group.MapOwnerSubscriptionEndpoints();   // buying and renewing the Verified plan, per listing
        group.MapOwnerAlertEndpoints();   // staff requests to correct something, and marking them read
        group.MapOwnerOpeningHoursEndpoints();   // when the business is open
        group.MapOwnerListingContentEndpoints();  // FAQs and content sections, capped by the plan
        group.MapOwnerAttributeEndpoints();       // offerings, languages and amenities
        return group;
    }

    // ------------------------------------------------------------------ list / get
    private static async Task<IResult> List(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);

        var listings = new List<OwnerListingDto>();
        await using (var command = new SqlCommand(OwnedListingSelect + " ORDER BY li.created_at DESC", conn))
        {
            command.Parameters.AddWithValue("user", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                listings.Add(Read(reader));
            }
        }

        /* Every staged edit this owner has, in one more query (S0031), so a card can say "changes
           waiting" instead of looking identical to a listing nobody has touched. */
        var staged = await PendingChanges.ForOwnerAsync(conn, null, userId, ct);
        return Results.Ok(staged.Count == 0
            ? listings
            : listings
                .Select(listing => staged.TryGetValue(listing.Id, out var pending)
                    ? listing with { PendingChanges = ToDto(pending) }
                    : listing)
                .ToList());
    }

    private static async Task<IResult> Get(long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var listing = await LoadOwned(conn, null, userId, id, ct);
        return listing is null ? Results.NotFound() : Results.Ok(listing);
    }

    // ------------------------------------------------------------------ create
    private static async Task<IResult> Create(
        ListingInput input,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var ownerPhone = await GetOwnerPhone(conn, tx, userId, ct);
        if (ownerPhone is null)
        {
            return Results.Unauthorized();
        }

        var validation = ListingValidator.Validate(input, requireLocality: true, fallbackPhone: ownerPhone);
        if (validation.Value is not { } value)
        {
            return Results.ValidationProblem(validation.Errors);
        }

        long existing;
        await using (var count = new SqlCommand(
            @"SELECT COUNT_BIG(*) FROM dbo.listings li
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              WHERE li.status <> 'archived'", conn, tx))
        {
            count.Parameters.AddWithValue("user", userId);
            existing = (long)(await count.ExecuteScalarAsync(ct))!;
        }
        if (existing >= MaxListingsPerOwner)
        {
            return Results.Problem($"You can have at most {MaxListingsPerOwner} listings.", statusCode: StatusCodes.Status409Conflict);
        }

        var locality = await ListingWriter.FindLocality(conn, tx, value.CitySlug, value.LocalitySlug!, ct);
        if (locality is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["localitySlug"] = ["Unknown area."] });
        }

        var categoryId = await ListingWriter.FindCategoryId(conn, tx, value.CategorySlug, ct);
        if (categoryId is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["categorySlug"] = ["Unknown category."] });
        }

        var slug = await ListingWriter.ChooseSlug(conn, tx, value.Name, ct);

        /* Save Changes keeps a new listing out of the queue however complete it looks: the owner
           is still building it, and deciding for them that it was finished is what made putting
           work aside impossible. Submit is the only way in, and it has to be ready -- the owner
           is told which field is missing rather than the listing being created half-queued. */
        if (input.SubmitForReview)
        {
            var notReady = ListingReadiness.MissingForReview(value.AddressLine, value.Description);
            if (notReady.Count > 0)
            {
                return Results.ValidationProblem(notReady);
            }
        }

        // A new listing is a draft until the owner submits it, which is the same rule an edit follows.
        var initialStatus = ListingReadiness.StatusAfterOwnerSave("draft", input.SubmitForReview);

        long listingId;
        try
        {
            var businessId = await ListingWriter.InsertBusiness(conn, tx, value.Name, ct);

            await using (var member = new SqlCommand(
                "INSERT INTO dbo.business_members (business_id, user_id, role) VALUES (@business, @user, 'owner')", conn, tx))
            {
                member.Parameters.AddWithValue("business", businessId);
                member.Parameters.AddWithValue("user", userId);
                await member.ExecuteNonQueryAsync(ct);
            }

            /* Draft unless the owner pressed Submit, so nothing reaches a reviewer by accident
               and nothing an owner is still working on is taken out of their hands. */
            listingId = await ListingWriter.InsertListing(
                conn, tx, businessId, locality, slug, value, status: initialStatus, source: "owner", createdByUserId: userId, ct);

            await ListingWriter.AddPrimaryCategory(conn, tx, listingId, categoryId.Value, ct);
        }
        catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            // Two owners picked the same name in the same area at the same moment. Ask the caller to retry.
            return Results.Problem("That name was just taken in this area. Please try again.", statusCode: StatusCodes.Status409Conflict);
        }

        await WriteAudit(conn, tx, userId, "listing.created", listingId, http, ct);
        var dto = await LoadOwned(conn, tx, userId, listingId, ct);
        await tx.CommitAsync(ct);
        return Results.Created($"/api/v1/me/listings/{listingId}", dto);
    }

    // ------------------------------------------------------------------ update
    private static async Task<IResult> Update(
        long id,
        ListingInput input,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var ownerPhone = await GetOwnerPhone(conn, tx, userId, ct);
        if (ownerPhone is null)
        {
            return Results.Unauthorized();
        }

        var lockResult = await LockOwned(conn, tx, userId, id, ct);
        if (lockResult is null)
        {
            return Results.NotFound();
        }
        if (lockResult.Value.Status == "suspended")
        {
            return Results.Problem("This listing is suspended. Please contact support.", statusCode: StatusCodes.Status403Forbidden);
        }
        if (lockResult.Value.Status == "archived")
        {
            return Results.Problem("This listing is archived and can no longer be edited.", statusCode: StatusCodes.Status409Conflict);
        }

        // The area (and so the URL) cannot be changed here; it is ignored on edit.
        var validation = ListingValidator.Validate(input, requireLocality: false, fallbackPhone: ownerPhone);
        if (validation.Value is not { } value)
        {
            return Results.ValidationProblem(validation.Errors);
        }

        var currentStatus = lockResult.Value.Status;
        var missing = ListingReadiness.MissingForReview(value.AddressLine, value.Description);

        /* A listing no reviewer has passed yet -- a draft, or one that came back rejected -- may
           be saved in any state, because that is what saving progress means. It stays where it
           is until the owner submits it. */
        var neverPublic = ListingReadiness.NeverPublic(currentStatus);

        if (input.SubmitForReview)
        {
            // Submit has to be ready, whatever the listing status is now.
            if (missing.Count > 0)
            {
                return Results.ValidationProblem(missing);
            }
        }
        else if (missing.Count > 0 && !neverPublic)
        {
            /* A listing a reviewer has already seen may not be saved into an incomplete state:
               that would drop a live business off the site over a cleared description, which is
               a worse answer than refusing the save and saying what is missing. */
            return Results.ValidationProblem(missing);
        }

        var categoryId = await ListingWriter.FindCategoryId(conn, tx, value.CategorySlug, ct);
        if (categoryId is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["categorySlug"] = ["Unknown category."] });
        }

        /* An edit to a listing that is already published does not touch the listing (S0031).
           It is written aside, the page keeps serving the approved version, and a moderator decides
           whether it goes live -- which is what this used to do by taking the business off the site
           for the duration, and the comment here used to say was the only option without somewhere
           to put the edit.

           Nothing else changes: the owner's own screens read the staged values back, so they
           continue from where they were rather than from the live text. */
        if (PendingChanges.IsPublished(currentStatus))
        {
            await PendingChanges.UpsertAsync(
                conn, tx, id, userId, value, categoryId.Value, input.SubmitForReview, ct);

            await WriteAudit(
                conn, tx, userId,
                input.SubmitForReview ? "listing.changes_submitted" : "listing.changes_saved",
                id, http, ct);

            var staged = await LoadOwned(conn, tx, userId, id, ct);
            await tx.CommitAsync(ct);
            return Results.Ok(staged);
        }

        await ListingWriter.UpdateListing(conn, tx, id, value, lockResult.Value.Latitude, lockResult.Value.Longitude, ct);
        await ListingWriter.SetPrimaryCategory(conn, tx, id, categoryId.Value, ct);

        /* What a save does to the status of a listing that is *not* published.

           Submit queues it. Save leaves a draft a draft and a rejection a rejection, so an owner
           can build a listing across several sittings without it being reviewed in between. There
           is no public version to protect in either case, so the edit is written straight through.

           The rejection note is cleared only when the listing actually enters the queue: a save
           that leaves it rejected keeps the note, because the owner is still reading it. */
        var newStatus = ListingReadiness.StatusAfterOwnerSave(currentStatus, input.SubmitForReview);
        var entersQueue = newStatus == "pending_review";

        await using (var requeue = new SqlCommand(
            @"UPDATE dbo.listings
              SET status = @status,
                  review_note = CASE WHEN @entersQueue = 1 THEN NULL ELSE review_note END,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            requeue.Parameters.AddWithValue("id", id);
            requeue.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar) { Value = newStatus });
            requeue.Parameters.AddWithValue("entersQueue", entersQueue);
            await requeue.ExecuteNonQueryAsync(ct);
        }

        await WriteAudit(conn, tx, userId, "listing.updated", id, http, ct);
        var dto = await LoadOwned(conn, tx, userId, id, ct);
        await tx.CommitAsync(ct);
        return Results.Ok(dto);
    }

    // ------------------------------------------------------------------ submit for review
    private static async Task<IResult> Submit(
        long id,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var lockResult = await LockOwned(conn, tx, userId, id, ct);
        if (lockResult is null)
        {
            return Results.NotFound();
        }
        if (lockResult.Value.Status is not ("draft" or "rejected"))
        {
            return Results.Problem("Only draft or rejected listings can be submitted.", statusCode: StatusCodes.Status409Conflict);
        }

        var listing = await LoadOwned(conn, tx, userId, id, ct);
        if (listing is null)
        {
            return Results.NotFound();
        }

        /* The same rule creating and editing use. This endpoint is still here for a draft made
           before saving started queueing automatically, and for anything that calls it directly. */
        var missing = ListingReadiness.MissingForReview(listing.AddressLine, listing.Description);
        if (missing.Count > 0)
        {
            return Results.ValidationProblem(missing);
        }

        // The old rejection reason goes with the old version: the owner has just changed the listing.
        await using (var submit = new SqlCommand(
            "UPDATE dbo.listings SET status = 'pending_review', review_note = NULL, updated_at = SYSDATETIMEOFFSET() WHERE id = @id", conn, tx))
        {
            submit.Parameters.AddWithValue("id", id);
            await submit.ExecuteNonQueryAsync(ct);
        }

        await WriteAudit(conn, tx, userId, "listing.submitted", id, http, ct);
        var dto = await LoadOwned(conn, tx, userId, id, ct);
        await tx.CommitAsync(ct);
        return Results.Ok(dto);
    }

    // ------------------------------------------------------------------ helpers
    private static OwnerListingDto Read(SqlDataReader r)
    {
        var city = r.GetString(11);
        var locality = r.GetString(12);
        var category = r.GetString(14);
        var slug = r.GetString(1);
        return new OwnerListingDto(
            r.GetInt64(0),
            slug,
            r.GetString(2),
            r.IsDBNull(3) ? null : r.GetString(3),
            r.IsDBNull(4) ? null : r.GetString(4),
            r.IsDBNull(5) ? null : r.GetString(5),
            r.GetString(6),
            r.IsDBNull(7) ? null : r.GetString(7),
            r.IsDBNull(8) ? null : r.GetString(8),
            r.GetDouble(9),
            r.GetDouble(10),
            city,
            locality,
            r.GetString(13),
            category,
            r.GetString(15),
            r.GetString(16),
            r.IsDBNull(17) ? null : r.GetString(17),
            r.IsDBNull(18) ? null : r.GetFieldValue<DateTimeOffset>(18),
            PublicUrl.ForListing(r.GetString(19), category, slug)!,
            r.GetString(20),
            r.GetString(21),
            r.GetBoolean(22),
            r.IsDBNull(23) ? null : r.GetFieldValue<DateTimeOffset>(23),
            // COUNT_BIG returns bigint; the count of open alerts on one listing fits an int easily.
            (int)r.GetInt64(24));
    }

    private static async Task<OwnerListingDto?> LoadOwned(SqlConnection conn, SqlTransaction? tx, long userId, long listingId, CancellationToken ct)
    {
        OwnerListingDto? dto;
        await using (var command = new SqlCommand(OwnedListingSelect + " AND li.id = @id", conn, tx))
        {
            command.Parameters.AddWithValue("user", userId);
            command.Parameters.AddWithValue("id", listingId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            dto = await reader.ReadAsync(ct) ? Read(reader) : null;
        }

        if (dto is null)
        {
            return null;
        }

        /* The owner's own edit, if they have one waiting (S0031). A second query rather than a join:
           the select above is read by position and documented as append-only, and a staged edit has
           fourteen fields of its own. */
        var staged = await PendingChanges.ForListingAsync(conn, tx, listingId, ct);
        return staged is null ? dto : dto with { PendingChanges = ToDto(staged) };
    }

    /// <summary>The staged edit as the owner's screens read it.</summary>
    private static PendingChangeDto ToDto(PendingChanges.Staged staged) => new(
        staged.Status,
        staged.Name,
        staged.Description,
        staged.AddressLine,
        staged.Pincode,
        staged.PhonePrimary,
        staged.PhoneWhatsapp,
        staged.WebsiteUrl,
        staged.CategorySlug,
        staged.CategoryName,
        staged.ReviewNote,
        staged.SubmittedAt,
        staged.ReviewedAt,
        staged.UpdatedAt);

    /// <summary>
    /// Throws away the owner's staged edit, so their screens show the published version again.
    /// </summary>
    /// <remarks>
    /// Only their own, and only one that has not been applied -- an applied edit is not a row any
    /// more, it is the listing. A rejected one may be discarded too: that is an owner deciding the
    /// moderator was right and they would rather start from what is live.
    /// </remarks>
    private static async Task<IResult> DiscardPendingChanges(
        long id,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        // Ownership first, through the same lock every other write on this listing takes.
        var lockResult = await LockOwned(conn, tx, userId, id, ct);
        if (lockResult is null)
        {
            return Results.NotFound();
        }

        if (!await PendingChanges.DiscardAsync(conn, tx, id, ct))
        {
            return Results.NotFound();
        }

        await WriteAudit(conn, tx, userId, "listing.changes_discarded", id, http, ct);
        var dto = await LoadOwned(conn, tx, userId, id, ct);
        await tx.CommitAsync(ct);
        return Results.Ok(dto);
    }

    /// <summary>Locks the row so two edits cannot interleave. Returns null if the listing is not the caller's.</summary>
    private static async Task<(string Status, double Latitude, double Longitude)?> LockOwned(
        SqlConnection conn, SqlTransaction tx, long userId, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            /* The row is locked as it is read, so two requests for the same one queue rather than
               both acting on what they saw. PostgreSQL wrote that as FOR UPDATE after the query;
               SQL Server puts it on the table as a hint. HOLDLOCK keeps it to the end of the
               transaction, which is what FOR UPDATE did. */
            @"SELECT li.status, li.location.Lat, li.location.Long
              FROM dbo.listings li WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              WHERE li.id = @id AND li.status <> 'archived'", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("id", listingId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? (reader.GetString(0), reader.GetDouble(1), reader.GetDouble(2)) : null;
    }

    private static async Task<string?> GetOwnerPhone(SqlConnection conn, SqlTransaction tx, long userId, CancellationToken ct)
    {
        await using var command = new SqlCommand("SELECT phone_e164 FROM dbo.users WHERE id = @id AND status = 'active'", conn, tx);
        command.Parameters.AddWithValue("id", userId);
        return (string?)await command.ExecuteScalarAsync(ct);
    }

    private static async Task WriteAudit(SqlConnection conn, SqlTransaction tx, long userId, string action, long listingId, HttpContext http, CancellationToken ct)
    {
        IPAddress? ip = http.Connection.RemoteIpAddress;
        await using var command = new SqlCommand(
            @"INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, ip)
              VALUES ('owner', @user, @action, 'listing', @entity, @ip)", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("entity", listingId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        command.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
        await command.ExecuteNonQueryAsync(ct);
    }
}
