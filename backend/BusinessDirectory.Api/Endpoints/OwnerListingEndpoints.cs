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
/// A listing goes to review when the owner saves it, not when they press a separate button: a
/// complete one is created as "pending_review", and every later edit puts it back there. That means
/// a live listing leaves the public site until a moderator approves the change -- deliberate, so
/// nothing reaches the public that a reviewer has not seen. Only an incomplete draft stays put.
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
        int OpenAlerts);

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
          FROM listings li
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
          JOIN dbo.listing_entitlements e ON e.listing_id = li.id
          JOIN localities lo ON lo.id = li.locality_id
          JOIN cities ci ON ci.id = lo.city_id
          JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
          JOIN categories pc ON pc.id = lc.category_id
          -- A public path is /parent/category/slug, so the parent travels with every listing.
          JOIN categories pcparent ON pcparent.id = pc.parent_id
          WHERE li.status <> 'archived'";

    public static RouteGroupBuilder MapOwnerListingEndpoints(this RouteGroupBuilder me)
    {
        var group = me.MapGroup("/listings");
        group.MapGet("", List);
        group.MapPost("", Create);
        group.MapGet("/{id:long}", Get);
        group.MapPut("/{id:long}", Update);
        group.MapPost("/{id:long}/submit", Submit);
        group.MapOwnerMediaEndpoints();   // photos, logo and video, with the plan allowance enforced
        group.MapOwnerLinkEndpoints();    // website and social links, capped by the plan's allowance
        group.MapOwnerSubscriptionEndpoints();   // buying and renewing the Verified plan, per listing
        group.MapOwnerAlertEndpoints();   // staff requests to correct something, and marking them read
        return group;
    }

    // ------------------------------------------------------------------ list / get
    private static async Task<IResult> List(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var command = db.CreateCommand(OwnedListingSelect + " ORDER BY li.created_at DESC");
        command.Parameters.AddWithValue("user", userId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        var listings = new List<OwnerListingDto>();
        while (await reader.ReadAsync(ct))
        {
            listings.Add(Read(reader));
        }
        return Results.Ok(listings);
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
            @"SELECT COUNT_BIG(*) FROM listings li
              JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
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
        var initialStatus = ListingReadiness.IsReadyForReview(value.AddressLine, value.Description)
            ? "pending_review"
            : "draft";

        long listingId;
        try
        {
            var businessId = await ListingWriter.InsertBusiness(conn, tx, value.Name, ct);

            await using (var member = new SqlCommand(
                "INSERT INTO business_members (business_id, user_id, role) VALUES (@business, @user, 'owner')", conn, tx))
            {
                member.Parameters.AddWithValue("business", businessId);
                member.Parameters.AddWithValue("user", userId);
                await member.ExecuteNonQueryAsync(ct);
            }

            /* A listing goes to review the moment it is complete, without the owner having to find
               a "submit" button. The full form asks for an address and a description, so this is
               normally "pending_review" straight away; it stays a draft only when something the
               reviewer needs is still missing, and the owner is told which. */
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

        /* Every edit goes back through review, so what an owner changes is seen before the public
           sees it. A draft that is still incomplete simply stays a draft -- saving progress must
           keep working -- but a listing that has already been reviewed may not be saved into an
           incomplete state: that would drop a live business off the site over a cleared
           description, which is a worse answer than refusing the save and saying what is missing. */
        var missing = ListingReadiness.MissingForReview(value.AddressLine, value.Description);
        var wasDraft = lockResult.Value.Status == "draft";
        if (missing.Count > 0 && !wasDraft)
        {
            return Results.ValidationProblem(missing);
        }

        var categoryId = await ListingWriter.FindCategoryId(conn, tx, value.CategorySlug, ct);
        if (categoryId is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["categorySlug"] = ["Unknown category."] });
        }

        await ListingWriter.UpdateListing(conn, tx, id, value, lockResult.Value.Latitude, lockResult.Value.Longitude, ct);
        await ListingWriter.SetPrimaryCategory(conn, tx, id, categoryId.Value, ct);

        /* Back into the queue. A live listing leaves the public site until a moderator approves it
           again -- that is the point of re-reviewing an edit, not a side effect -- and the old
           rejection note goes with the old version, exactly as the submit path has always done.
           An incomplete draft is the one case that stays put, with nothing queued. */
        var newStatus = missing.Count > 0 ? "draft" : "pending_review";
        await using (var requeue = new SqlCommand(
            @"UPDATE listings
              SET status = @status, review_note = NULL, updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            requeue.Parameters.AddWithValue("id", id);
            requeue.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar) { Value = newStatus });
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
            "UPDATE listings SET status = 'pending_review', review_note = NULL, updated_at = SYSDATETIMEOFFSET() WHERE id = @id", conn, tx))
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
        await using var command = new SqlCommand(OwnedListingSelect + " AND li.id = @id", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("id", listingId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? Read(reader) : null;
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
              FROM listings li WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              WHERE li.id = @id AND li.status <> 'archived'", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("id", listingId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? (reader.GetString(0), reader.GetDouble(1), reader.GetDouble(2)) : null;
    }

    private static async Task<string?> GetOwnerPhone(SqlConnection conn, SqlTransaction tx, long userId, CancellationToken ct)
    {
        await using var command = new SqlCommand("SELECT phone_e164 FROM users WHERE id = @id AND status = 'active'", conn, tx);
        command.Parameters.AddWithValue("id", userId);
        return (string?)await command.ExecuteScalarAsync(ct);
    }

    private static async Task WriteAudit(SqlConnection conn, SqlTransaction tx, long userId, string action, long listingId, HttpContext http, CancellationToken ct)
    {
        IPAddress? ip = http.Connection.RemoteIpAddress;
        await using var command = new SqlCommand(
            @"INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, ip)
              VALUES ('owner', @user, @action, 'listing', @entity, @ip)", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("entity", listingId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        command.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
        await command.ExecuteNonQueryAsync(ct);
    }
}
