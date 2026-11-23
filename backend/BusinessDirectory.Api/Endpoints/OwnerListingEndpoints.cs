using BusinessDirectory.Api.Data;
using System.Data;
using System.Net;
using System.Security.Claims;
using BusinessDirectory.Api.Listings;
using BusinessDirectory.Api.Media;
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
        /// The owner's edit to this published listing, waiting to go live (S0034). Null when there
        /// is none, which is every listing nobody has edited since it was published.
        ///
        /// The fields above are what the public sees. This says where the proposed version is: it is
        /// a listing of its own, with its own photos, hours, questions and links, and
        /// <c>listingId</c> is the id the editor opens.
        /// </summary>
        PendingChangeDto? PendingChanges = null,

        /// <summary>
        /// The published listing this row is a staged copy of, or null for an ordinary listing.
        ///
        /// Set on the copy itself, so a screen that has been handed one knows it is looking at a
        /// proposal rather than at a business: the editor says so, and Submit sends it for review
        /// rather than publishing it.
        /// </summary>
        long? StagedForListingId = null,

        /// <summary>
        /// True for a new listing that has been started and never saved (S0034).
        ///
        /// It exists so that photos, opening times and questions -- all of which belong to a listing
        /// -- can be added before anything is saved. It is kept out of the five-listing limit and
        /// labelled in the owner's list, and the first save clears it.
        /// </summary>
        bool IsPlaceholder = false);

    /// <param name="ListingId">The staged copy's own id. This is what the editor opens.</param>
    /// <param name="Status">draft (private), pending_review (in the queue) or rejected (with a note).</param>
    public sealed record PendingChangeDto(
        long ListingId,
        string Status,
        string? ReviewNote,
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
                  WHERE a.listing_id = li.id AND a.acknowledged_at IS NULL) AS open_alerts,
                 li.staged_for_listing_id, li.is_placeholder
          FROM dbo.listings li
          JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
          JOIN dbo.listing_entitlements e ON e.listing_id = li.id
          JOIN dbo.localities lo ON lo.id = li.locality_id
          JOIN dbo.cities ci ON ci.id = lo.city_id
          JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
          JOIN dbo.categories pc ON pc.id = lc.category_id
          -- A public path is /parent/category/slug, so the parent travels with every listing.
          JOIN dbo.categories pcparent ON pcparent.id = pc.parent_id
          /* Not the staged copies (S0034). A staged listing is a real row in this table -- the
             owner's proposed next version of a published listing -- and it belongs to the same
             business, so without this it would appear in My Listings as a second business. It is
             reachable by its own id, which is how the editor opens it.

             A placeholder *is* listed: it is an unsaved new listing, and the card is how its owner
             gets back to it. It is kept out of the five-listing limit instead. */
          WHERE li.status <> 'archived' AND li.staged_for_listing_id IS NULL";

    public static RouteGroupBuilder MapOwnerListingEndpoints(this RouteGroupBuilder me)
    {
        var group = me.MapGroup("/listings");
        group.MapGet("", List);
        group.MapPost("", Create);
        group.MapGet("/{id:long}", Get);
        group.MapPut("/{id:long}", Update);
        group.MapPost("/{id:long}/submit", Submit);
        /* Editing a listing that is on the site: this takes the copy, and everything after it is an
           ordinary draft listing that happens to be a proposal (S0034). */
        group.MapPost("/{id:long}/pending-changes", StartPendingChanges);
        /* Throwing away an edit that has not gone live, so the owner sees the published version
           again. Theirs to discard: it is their work and nothing public depends on it. */
        group.MapDelete("/{id:long}/pending-changes", DiscardPendingChanges);
        /* A new listing, before anything has been typed into it. See StagedListings for why a row
           exists this early: a photo, an opening time and a question all belong to a listing. */
        group.MapPost("/placeholder", StartNewListing);
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

        /* Every staged edit this owner has, in one more query (S0034), so a card can say "changes
           waiting" instead of looking identical to a listing nobody has touched. */
        var staged = await StagedListings.ForOwnerAsync(conn, null, userId, ct);
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
            /* Real listings only. A staged edit is a copy of one that already counts, and a
               placeholder is a new listing that has not been saved -- counting either would tell an
               owner they are at the limit when they are not. */
            @"SELECT COUNT_BIG(*) FROM dbo.listings li
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              WHERE li.status <> 'archived'
                AND li.staged_for_listing_id IS NULL
                AND li.is_placeholder = 0", conn, tx))
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

        /* A published listing is never written to here (S0034). Its editor opens a staged copy
           -- a listing of its own, with its own photos, hours, questions and links -- and this
           endpoint is then called with *that* id, which is a draft and takes the ordinary path
           below. Refusing it rather than quietly redirecting the write is the point: an owner's
           save must land where their screen says it landed, and a client that has not been told
           about staging should be told, not silently redirected.

           POST /me/listings/{id}/pending-changes is how the copy is made. */
        if (currentStatus == "active")
        {
            return Results.Problem(
                "This listing is on the site. Start a pending change first and edit that copy, so the live page keeps working until we approve it.",
                statusCode: StatusCodes.Status409Conflict);
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

        /* The first real save turns an unsaved new listing into an ordinary draft. A no-op for
           anything else, which is why it is called without asking. */
        await StagedListings.ClearPlaceholderAsync(conn, tx, id, ct);

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
            (int)r.GetInt64(24),
            /* The staged edit itself is read separately (LoadOwned), so this stays null here and is
               filled in there. These two say what *this* row is: a staged copy, or a new listing
               nobody has saved yet. */
            PendingChanges: null,
            StagedForListingId: r.IsDBNull(25) ? null : r.GetInt64(25),
            IsPlaceholder: r.GetBoolean(26));
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

        /* The owner's own edit, if they have one waiting (S0034). A second query rather than a
           join: the select above is read by position and documented as append-only. */
        var staged = await StagedListings.ForListingAsync(conn, tx, listingId, ct);
        return staged is null ? dto : dto with { PendingChanges = ToDto(staged) };
    }

    /// <summary>The staged edit as the owner's screens read it.</summary>
    private static PendingChangeDto ToDto(StagedListings.Staged staged) => new(
        staged.ListingId,
        staged.Status,
        staged.ReviewNote,
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
    /// <summary>
    /// Takes a copy of a published listing for its owner to edit (S0034).
    /// </summary>
    /// <remarks>
    /// The copy includes every section -- photos, opening hours, questions, content, amenities,
    /// links -- so the owner edits their own version of the whole listing and the published one
    /// keeps serving every part of it until a moderator approves the change.
    ///
    /// Idempotent: a second call returns the copy that already exists rather than a second one, and
    /// the filtered unique index on <c>staged_for_listing_id</c> makes that true even under two
    /// requests at once. The listing row is locked first, so the two queue instead of racing.
    ///
    /// Only a published listing has anything to stage. A draft, a rejection or a listing already in
    /// the review queue is edited in place: there is no public version to protect, which is the same
    /// rule the update handler applies.
    /// </remarks>
    private static async Task<IResult> StartPendingChanges(
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
        if (lockResult.Value.Status != "active")
        {
            return Results.Problem(
                "This listing is not on the site, so there is nothing to protect while you edit it. Edit it directly.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var existing = await StagedListings.ForListingAsync(conn, tx, id, ct);
        if (existing is not null)
        {
            await tx.CommitAsync(ct);
            return Results.Ok(await Load(db, userId, existing.ListingId, ct));
        }

        var stagedId = await StagedListings.CreateAsync(conn, tx, id, userId, ct);
        await WriteAudit(conn, tx, userId, "listing.changes_started", id, http, ct);
        var dto = await LoadOwned(conn, tx, userId, stagedId, ct);
        await tx.CommitAsync(ct);
        return Results.Ok(dto);
    }

    /// <summary>
    /// Throws a staged copy away, so the owner's screens show the published listing again.
    /// </summary>
    /// <remarks>
    /// Takes the published listing's id, because that is what the owner is looking at. Files are
    /// deleted after the transaction commits, and only the ones no row references any anymore -- a
    /// photo copied from the published listing is still that listing's photo, and deleting its file
    /// would blank the live page. See <c>StagedListings.DiscardAsync</c>.
    /// </remarks>
    private static async Task<IResult> DiscardPendingChanges(
        long id,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        IMediaStorage storage,
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

        var staged = await StagedListings.ForListingAsync(conn, tx, id, ct);
        if (staged is null)
        {
            return Results.NotFound();
        }

        var orphaned = await StagedListings.DiscardAsync(conn, tx, staged.ListingId, ct);
        await WriteAudit(conn, tx, userId, "listing.changes_discarded", id, http, ct);
        var dto = await LoadOwned(conn, tx, userId, id, ct);
        await tx.CommitAsync(ct);

        /* After the commit, never before: a rolled-back discard that had already deleted the files
           would leave rows pointing at nothing. A failure here leaves a file nobody references,
           which costs pence and is cleaned up by the script in database/sqlserver/manual. */
        foreach (var key in orphaned)
        {
            await storage.DeleteAsync(key, CancellationToken.None);
        }

        return Results.Ok(dto);
    }

    /// <summary>
    /// The owner's unsaved new listing, created if they do not have one (S0034).
    /// </summary>
    /// <remarks>
    /// This is what lets somebody fill all five sections of a new listing before saving anything: a
    /// photo, an opening time and a question all belong to a listing, so the listing exists from the
    /// moment they press Add. It is a draft, so the public never sees it, and it is marked as a
    /// placeholder, which keeps it out of the five-listing limit and labels it in their list.
    ///
    /// Pressing Add twice returns the same listing. That is enforced by a unique filtered index
    /// rather than by this check alone, so two requests at once cannot both create one.
    ///
    /// It needs a business and an area. The business is the owner's own (registration creates it);
    /// the area is their first listing's, because a new listing's area is chosen on the form and
    /// the row needs something until then -- it is saved with whatever the form says.
    /// </remarks>
    private static async Task<IResult> StartNewListing(
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

        long businessId;
        int localityId;
        await using (var owned = new SqlCommand(
            /* The owner's business, and an area to start the row in. Ordered so the answer does not
               change between calls. A registered owner always has both: onboarding creates the
               business and the first listing. */
            @"SELECT TOP (1) bm.business_id, li.locality_id
              FROM dbo.business_members bm
              JOIN dbo.listings li ON li.business_id = bm.business_id
              WHERE bm.user_id = @user
              ORDER BY li.created_at, li.id", conn, tx))
        {
            owned.Parameters.AddWithValue("user", userId);
            await using var reader = await owned.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.Problem(
                    "Finish registering your business first.",
                    statusCode: StatusCodes.Status409Conflict);
            }
            businessId = reader.GetInt64(0);
            localityId = reader.GetInt32(1);
        }

        /* The limit is checked here as well as on create: a placeholder does not count towards it,
           but somebody at the limit should be told now rather than after filling in five sections. */
        await using (var count = new SqlCommand(
            @"SELECT COUNT_BIG(*) FROM dbo.listings li
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              WHERE li.status <> 'archived'
                AND li.staged_for_listing_id IS NULL
                AND li.is_placeholder = 0", conn, tx))
        {
            count.Parameters.AddWithValue("user", userId);
            if ((long)(await count.ExecuteScalarAsync(ct))! >= MaxListingsPerOwner)
            {
                return Results.Problem(
                    $"You have reached the limit of {MaxListingsPerOwner} listings.",
                    statusCode: StatusCodes.Status409Conflict);
            }
        }

        var listingId = await StagedListings.GetOrCreatePlaceholderAsync(
            conn, tx, userId, businessId, localityId, ownerPhone, ct);

        await WriteAudit(conn, tx, userId, "listing.started", listingId, http, ct);
        var dto = await LoadOwned(conn, tx, userId, listingId, ct);
        await tx.CommitAsync(ct);
        return Results.Ok(dto);
    }

    /// <summary>One listing, on its own connection. For the paths that have already committed.</summary>
    private static async Task<OwnerListingDto?> Load(
        SqlDatabase db, long userId, long listingId, CancellationToken ct)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        return await LoadOwned(conn, null, userId, listingId, ct);
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
