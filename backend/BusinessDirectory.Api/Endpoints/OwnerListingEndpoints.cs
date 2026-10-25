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
/// New listings start as "draft"; the owner submits them for review. Approval (draft -> active) is an admin action (Phase 5).
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
        string Url);

    private const string OwnedListingSelect =
        @"SELECT li.id, li.slug, li.name, li.description, li.address_line, li.pincode, li.phone_primary, li.phone_whatsapp,
                 li.website_url, li.location.Lat, li.location.Long,
                 ci.slug, lo.slug, lo.name, pc.slug, pc.name, li.status, li.review_note, li.reviewed_at
          FROM listings li
          JOIN business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
          JOIN localities lo ON lo.id = li.locality_id
          JOIN cities ci ON ci.id = lo.city_id
          JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
          JOIN categories pc ON pc.id = lc.category_id
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

        var slug = await ListingWriter.ChooseSlug(conn, tx, locality.Id, value.Name, ct);

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

            // An owner's listing starts as a draft: they submit it for review when it is ready.
            listingId = await ListingWriter.InsertListing(
                conn, tx, businessId, locality, slug, value, status: "draft", source: "owner", createdByUserId: userId, ct);

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

        // The area (and so the URL) cannot be changed here; it is ignored on edit.
        var validation = ListingValidator.Validate(input, requireLocality: false, fallbackPhone: ownerPhone);
        if (validation.Value is not { } value)
        {
            return Results.ValidationProblem(validation.Errors);
        }

        var categoryId = await ListingWriter.FindCategoryId(conn, tx, value.CategorySlug, ct);
        if (categoryId is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["categorySlug"] = ["Unknown category."] });
        }

        await ListingWriter.UpdateListing(conn, tx, id, value, lockResult.Value.Latitude, lockResult.Value.Longitude, ct);
        await ListingWriter.SetPrimaryCategory(conn, tx, id, categoryId.Value, ct);

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

        // What a listing needs before a reviewer sees it.
        var missing = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(listing.AddressLine))
        {
            missing["addressLine"] = ["Add the business address before submitting."];
        }
        if (listing.Description is null || listing.Description.Length < 20)
        {
            missing["description"] = ["Add a short description (at least 20 characters) before submitting."];
        }
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
            $"/{city}/{locality}/{category}/{slug}");
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
