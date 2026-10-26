using BusinessDirectory.Api.Data;
using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Writing listings, under /api/v1/super-admin/listings: add by hand, correct, archive, delete.
///
/// This lived on /api/v1/admin until the surfaces were split. An admin now reviews what owners
/// submit — approve, reject, suspend, reinstate — and nothing more. Creating a business that walked
/// in, correcting someone else's details and removing a listing are platform work, so they sit
/// behind the super-admin token audience *and* their own permissions
/// (listings.create / listings.edit / listings.delete), which `AuthorizeSuper` will only accept
/// here. An ordinary admin token fails audience validation before any handler runs.
///
/// Creating and editing reuse ListingValidator and ListingWriter, the same code an owner's own
/// submission goes through, so a hand-made listing is the same kind of row as any other: only
/// `source` differs, and there is no owner account attached to it.
///
/// **Delete versus archive.** Every table that points at a listing does so `ON DELETE CASCADE`,
/// `dbo.subscriptions` and `dbo.subscription_payments` included. A hard delete of a listing that
/// ever paid would therefore take the money's record with it, silently. So delete is allowed only
/// while nothing financial is attached, and refused with a count otherwise; archive is always
/// available and is what "remove this from the site" should normally mean.
/// </summary>
public static class SuperAdminListingEndpoints
{
    public sealed record ListingRowDto(
        long Id,
        string Name,
        string Slug,
        string Status,
        string LocalityName,
        string? CategoryName,
        string PhonePrimary,
        bool IsVerified,
        DateTimeOffset? PaidUntil,
        DateTimeOffset CreatedAt);

    public sealed record ListingPageDto(
        IReadOnlyList<ListingRowDto> Items, int Page, int PageSize, int Total, int TotalPages);

    public sealed record DeleteBlockedDto(string Message, int Subscriptions, int Payments);

    private const int DefaultPageSize = 20;
    private const int MaxPageSize = 100;

    public static RouteGroupBuilder MapSuperAdminListingEndpoints(this RouteGroupBuilder super)
    {
        var group = super.MapGroup("/listings");
        group.MapGet("", List);
        group.MapGet("/{id:long}", Get);
        group.MapPost("", Create);
        group.MapPut("/{id:long}", Update);
        group.MapPost("/{id:long}/archive", Archive);
        group.MapDelete("/{id:long}", Delete);
        return group;
    }

    /// <summary>Loads the caller and checks one super-admin permission, or hands back the refusal.</summary>
    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, string permission, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return (null, Results.Unauthorized());
        }
        return (admin, AdminAccess.AuthorizeSuper(admin, permission));
    }

    // ------------------------------------------------------------------ find a listing to work on
    /// <summary>
    /// Every listing, newest first, optionally narrowed by name or by status. Reading is gated on
    /// listings.edit rather than a view permission of its own: this list exists to pick something to
    /// change, and the admin surface already has the read-only queue.
    /// </summary>
    private static async Task<IResult> List(
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct,
        string? q = null,
        string? status = null,
        int? page = null,
        int? pageSize = null)
    {
        var (_, refused) = await Gate(principal, db, AdminPermissions.ListingsEdit, ct);
        if (refused is not null)
        {
            return refused;
        }

        var currentPage = page is > 0 ? page.Value : 1;
        var size = pageSize is > 0 ? Math.Min(pageSize.Value, MaxPageSize) : DefaultPageSize;
        var search = string.IsNullOrWhiteSpace(q) ? null : q.Trim();

        /* One statement returns the page and the total, so the two cannot disagree. The ORDER BY is
           repeated outside the CTE because ordering only inside it returns the right rows in an
           arbitrary order -- the same lesson as the public search and the moderation queue. */
        await using var command = db.CreateCommand(
            @"WITH matched AS (
                SELECT li.id, li.name, li.slug, li.status, lo.name AS locality_name,
                       pc.name AS category_name, li.phone_primary, li.created_at,
                       e.is_verified, e.paid_until,
                       COUNT_BIG(*) OVER () AS total
                FROM dbo.listings li
                JOIN dbo.listing_entitlements e ON e.listing_id = li.id
                JOIN dbo.localities lo ON lo.id = li.locality_id
                LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
                LEFT JOIN dbo.categories pc ON pc.id = lc.category_id
                WHERE (@status IS NULL OR li.status = @status)
                  AND (@q IS NULL OR li.name LIKE '%' + @q + '%' OR li.slug LIKE '%' + @q + '%')
              )
              SELECT id, name, slug, status, locality_name, category_name, phone_primary,
                     is_verified, paid_until, created_at, total
              FROM matched
              ORDER BY created_at DESC
              OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY");
        command.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar) { Value = (object?)status ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("q", SqlDbType.NVarChar) { Value = (object?)search ?? DBNull.Value });
        command.Parameters.AddWithValue("skip", (currentPage - 1) * size);
        command.Parameters.AddWithValue("take", size);

        var items = new List<ListingRowDto>();
        var total = 0L;
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                items.Add(new ListingRowDto(
                    reader.GetInt64(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.IsDBNull(5) ? null : reader.GetString(5),
                    reader.GetString(6),
                    reader.GetBoolean(7),
                    reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8),
                    reader.GetFieldValue<DateTimeOffset>(9)));
                total = reader.GetInt64(10);
            }
        }

        var totalPages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)size);
        return Results.Ok(new ListingPageDto(items, currentPage, size, (int)total, totalPages));
    }

    private static async Task<IResult> Get(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, AdminPermissions.ListingsEdit, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var dto = await AdminListingEndpoints.LoadDetail(conn, null, id, ct);
        return dto is null ? Results.NotFound() : Results.Ok(dto);
    }

    // ------------------------------------------------------------------ add a listing by hand
    /// <summary>
    /// A business that phoned in or walked in. It goes live immediately: a super admin who may
    /// create a listing may also publish one, so sending it to the review queue would only make
    /// them approve their own work.
    /// </summary>
    private static async Task<IResult> Create(
        ListingInput input,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, AdminPermissions.ListingsCreate, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        // No owner account behind this listing, so the phone number has to be typed in: no fallback.
        var validation = ListingValidator.Validate(input, requireLocality: true, fallbackPhone: null);
        if (validation.Value is not { } value)
        {
            return Results.ValidationProblem(validation.Errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

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
            listingId = await ListingWriter.InsertListing(
                conn, tx, businessId, locality, slug, value, "active", source: "admin", createdByUserId: null, ct);
            await ListingWriter.AddPrimaryCategory(conn, tx, listingId, categoryId.Value, ct);
        }
        catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            // Two people picked the same name in the same area at the same moment. Ask them to retry.
            return Results.Problem("That name was just taken in this area. Please try again.", statusCode: StatusCodes.Status409Conflict);
        }

        // Stamping the reviewer makes it clear on the listing who put it live.
        await using (var stamp = new SqlCommand(
            "UPDATE dbo.listings SET reviewed_at = SYSDATETIMEOFFSET(), reviewed_by_admin_id = @admin WHERE id = @id", conn, tx))
        {
            stamp.Parameters.AddWithValue("id", listingId);
            stamp.Parameters.AddWithValue("admin", admin.Id);
            await stamp.ExecuteNonQueryAsync(ct);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.created_by_super_admin", "listing",
            listingId.ToString(System.Globalization.CultureInfo.InvariantCulture), http,
            new { status = "active", slug }, ct);

        var dto = await AdminListingEndpoints.LoadDetail(conn, tx, listingId, ct);
        await tx.CommitAsync(ct);
        return Results.Created($"/api/v1/super-admin/listings/{listingId}", dto);
    }

    // ------------------------------------------------------------------ correct a listing
    /// <summary>
    /// Corrects a listing's details. Editing never changes the status, so it cannot publish
    /// anything; the area is fixed after creation because it is part of the public URL.
    /// </summary>
    private static async Task<IResult> Update(
        long id,
        ListingInput input,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, AdminPermissions.ListingsEdit, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        // A listing always has a phone number already, so there is no fallback to supply.
        var validation = ListingValidator.Validate(input, requireLocality: false, fallbackPhone: null);
        if (validation.Value is not { } value)
        {
            return Results.ValidationProblem(validation.Errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        // Lock the row so an edit and a moderation decision cannot interleave.
        string status;
        double latitude;
        double longitude;
        await using (var find = new SqlCommand(
            @"SELECT status, location.Lat, location.Long
              FROM dbo.listings WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE id = @id", conn, tx))
        {
            find.Parameters.AddWithValue("id", id);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.NotFound();
            }
            status = reader.GetString(0);
            latitude = reader.GetDouble(1);
            longitude = reader.GetDouble(2);
        }

        if (status == "archived")
        {
            return Results.Problem("This listing is archived and can no longer be edited.", statusCode: StatusCodes.Status409Conflict);
        }

        var categoryId = await ListingWriter.FindCategoryId(conn, tx, value.CategorySlug, ct);
        if (categoryId is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["categorySlug"] = ["Unknown category."] });
        }

        await ListingWriter.UpdateListing(conn, tx, id, value, latitude, longitude, ct);
        await ListingWriter.SetPrimaryCategory(conn, tx, id, categoryId.Value, ct);

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.edited_by_super_admin", "listing",
            id.ToString(System.Globalization.CultureInfo.InvariantCulture), http, new { status }, ct);

        var dto = await AdminListingEndpoints.LoadDetail(conn, tx, id, ct);
        await tx.CommitAsync(ct);
        return Results.Ok(dto);
    }

    // ------------------------------------------------------------------ archive
    /// <summary>
    /// Takes a listing off the public site and leaves everything attached to it alone. This is the
    /// safe counterpart to delete, and the only option once money is involved.
    /// </summary>
    private static async Task<IResult> Archive(
        long id,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, AdminPermissions.ListingsDelete, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var update = new SqlCommand(
            @"UPDATE dbo.listings
              SET status = 'archived', updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id AND status <> 'archived'", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            if (await update.ExecuteNonQueryAsync(ct) == 0)
            {
                // Either it does not exist or it is already archived; both are "nothing to do".
                await using var exists = new SqlCommand("SELECT TOP (1) 1 FROM dbo.listings WHERE id = @id", conn, tx);
                exists.Parameters.AddWithValue("id", id);
                return await exists.ExecuteScalarAsync(ct) is null ? Results.NotFound() : Results.NoContent();
            }
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.archived_by_super_admin", "listing",
            id.ToString(System.Globalization.CultureInfo.InvariantCulture), http, new { }, ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    // ------------------------------------------------------------------ delete
    /// <summary>
    /// Removes the listing and everything that cascades from it: photos, categories, links,
    /// favourites, enquiries and reviews. Refused while a subscription or a payment row exists,
    /// because those cascade too and a financial record must not disappear with a listing. The
    /// refusal carries the counts and points at archive.
    /// </summary>
    private static async Task<IResult> Delete(
        long id,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, AdminPermissions.ListingsDelete, ct);
        if (refused is not null || admin is null)
        {
            return refused ?? Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        string slug;
        string name;
        long subscriptions;
        long payments;
        await using (var find = new SqlCommand(
            @"SELECT li.slug, li.name,
                     (SELECT COUNT_BIG(*) FROM dbo.subscriptions s WHERE s.listing_id = li.id),
                     (SELECT COUNT_BIG(*) FROM dbo.subscription_payments p WHERE p.listing_id = li.id)
              FROM dbo.listings li WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE li.id = @id", conn, tx))
        {
            find.Parameters.AddWithValue("id", id);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.NotFound();
            }
            slug = reader.GetString(0);
            name = reader.GetString(1);
            subscriptions = reader.GetInt64(2);
            payments = reader.GetInt64(3);
        }

        if (subscriptions > 0 || payments > 0)
        {
            return Results.Json(
                new DeleteBlockedDto(
                    "This listing has a subscription or payment history, which would be deleted with it. Archive it instead: that takes it off the site and keeps the records.",
                    (int)subscriptions,
                    (int)payments),
                statusCode: StatusCodes.Status409Conflict);
        }

        /* The audit row is written before the delete, and inside the same transaction. Written
           after, it would be recording a listing id that no longer resolves to anything -- which is
           fine for an append-only log, but writing it first means the log cannot be missing an
           entry if the delete throws: the whole transaction goes. */
        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.deleted_by_super_admin", "listing",
            id.ToString(System.Globalization.CultureInfo.InvariantCulture), http, new { slug, name }, ct);

        await using (var delete = new SqlCommand("DELETE FROM dbo.listings WHERE id = @id", conn, tx))
        {
            delete.Parameters.AddWithValue("id", id);
            await delete.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }
}
