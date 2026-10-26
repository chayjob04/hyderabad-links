using BusinessDirectory.Api.Data;
using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// The lists every listing and every public URL is built from: categories, their subcategories, and
/// Hyderabad's localities. Under /api/v1/admin, gated on <c>taxonomy.manage</c>.
///
/// Two rules shape the whole file.
///
/// **A slug is never edited.** `/hyderabad/madhapur/dentists/smile-care` is built from a city, a
/// locality and a category slug, so renaming a slug silently breaks every link and search result
/// that pointed at it. Listings have `slug_history` to survive that; categories and localities have
/// no such table, so the slug is settled once, when the row is created, and only the display name
/// moves afterwards. Admins who need a different slug create the new row and retire the old one.
///
/// **Retiring is not deleting.** `is_active = 0` hides a row from the public site everywhere
/// (PublicDirectoryEndpoints filters on it) while leaving the listings that sit on it intact.
/// Deleting is offered too, but only for a row nothing points at: the alternative is an FK error
/// mid-request, or -- worse, for localities -- a cascade. Every refusal says what is in the way and
/// how many.
/// </summary>
public static class AdminTaxonomyEndpoints
{
    // ---- requests ------------------------------------------------------------------------------
    /// <summary>`parentId` null creates a top-level category; otherwise a subcategory under it.</summary>
    public sealed record CategoryCreateRequest(string? Name, int? ParentId, int? SortOrder);

    /// <summary>No slug: see the class comment. Any field left null keeps its current value.</summary>
    public sealed record CategoryUpdateRequest(string? Name, int? SortOrder, bool? IsActive);

    public sealed record LocalityCreateRequest(
        string? CitySlug, string? Name, double? Latitude, double? Longitude, string? Pincode);

    public sealed record LocalityUpdateRequest(
        string? Name, double? Latitude, double? Longitude, string? Pincode, bool? IsActive);

    // ---- responses -----------------------------------------------------------------------------
    public sealed record CategoryDto(
        int Id,
        short Level,
        int? ParentId,
        string Slug,
        string Name,
        int SortOrder,
        bool IsActive,
        /// <summary>Listings on this category right now. A category with any cannot be deleted.</summary>
        int ListingCount,
        /// <summary>Subcategories under it, for a top-level category. Empty for a subcategory.</summary>
        IReadOnlyList<CategoryDto> Children);

    public sealed record CityDto(int Id, string Slug, string Name, string State, bool IsActive);

    public sealed record LocalityDto(
        int Id,
        int CityId,
        string CitySlug,
        string Slug,
        string Name,
        double Latitude,
        double Longitude,
        string? Pincode,
        bool IsActive,
        int ListingCount);

    public static RouteGroupBuilder MapAdminTaxonomyEndpoints(this RouteGroupBuilder admin)
    {
        var categories = admin.MapGroup("/categories");
        categories.MapGet("", ListCategories);
        categories.MapPost("", CreateCategory);
        categories.MapPut("/{id:int}", UpdateCategory);
        categories.MapDelete("/{id:int}", DeleteCategory);

        admin.MapGet("/cities", ListCities);

        var localities = admin.MapGroup("/localities");
        localities.MapGet("", ListLocalities);
        localities.MapPost("", CreateLocality);
        localities.MapPut("/{id:int}", UpdateLocality);
        localities.MapDelete("/{id:int}", DeleteLocality);

        return admin;
    }

    /// <summary>
    /// Loads the caller and checks taxonomy.manage, or hands back the response to send instead.
    /// Permissions are read from the database on every request, never from the token.
    /// </summary>
    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return (null, Results.Unauthorized());
        }
        return (admin, AdminAccess.Authorize(admin, AdminPermissions.TaxonomyManage));
    }

    // ================================================================= categories
    /// <summary>
    /// Every category, active or not, nested two deep. Inactive rows are included deliberately: this
    /// is the screen where an admin turns one back on, so hiding them would hide the way back.
    /// </summary>
    private static async Task<IResult> ListCategories(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        /* One query for both levels, with the listing count alongside. The count drives the delete
           button in the UI as well as the refusal below, so it is read here rather than guessed. */
        await using var command = db.CreateCommand(
            @"SELECT c.id, c.level, c.parent_id, c.slug, c.name, c.sort_order, c.is_active,
                     (SELECT COUNT_BIG(*) FROM dbo.listing_categories lc WHERE lc.category_id = c.id)
              FROM dbo.categories c
              ORDER BY c.level, c.sort_order, c.name");

        var all = new List<CategoryDto>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                all.Add(new CategoryDto(
                    reader.GetInt32(0),
                    reader.GetInt16(1),
                    reader.IsDBNull(2) ? null : reader.GetInt32(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetInt32(5),
                    reader.GetBoolean(6),
                    (int)reader.GetInt64(7),
                    []));
            }
        }

        // The ORDER BY put level 1 first, so every parent is already known when its children arrive.
        var tops = all.Where(c => c.Level == 1).ToList();
        var nested = tops
            .Select(t => t with { Children = all.Where(c => c.ParentId == t.Id).ToList() })
            .ToList();

        return Results.Ok(nested);
    }

    private static async Task<IResult> CreateCategory(
        CategoryCreateRequest request,
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

        if (!TryReadName(request.Name, out var name, out var nameError))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [nameError] });
        }

        if (!TryReadSlug(name, out var slug, out var slugError))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [slugError] });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        // A subcategory needs a live level-1 parent: the table's own CHECK allows a parent only at
        // level 1, and FindCategoryId (used when a listing is written) only ever matches level 2.
        short level = 1;
        if (request.ParentId is { } parentId)
        {
            await using var parent = new SqlCommand(
                "SELECT TOP (1) 1 FROM dbo.categories WHERE id = @id AND level = 1", conn, tx);
            parent.Parameters.AddWithValue("id", parentId);
            if (await parent.ExecuteScalarAsync(ct) is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["parentId"] = ["That parent category does not exist."],
                });
            }
            level = 2;
        }

        int id;
        try
        {
            await using var insert = new SqlCommand(
                @"INSERT INTO dbo.categories (level, parent_id, parent_level, slug, name, sort_order)
                  OUTPUT INSERTED.id
                  VALUES (@level, @parent, @parentLevel, @slug, @name, @sort)", conn, tx);
            insert.Parameters.AddWithValue("level", level);
            insert.Parameters.Add(new SqlParameter("parent", SqlDbType.Int)
            {
                Value = (object?)request.ParentId ?? DBNull.Value,
            });
            insert.Parameters.Add(new SqlParameter("parentLevel", SqlDbType.SmallInt)
            {
                Value = level == 2 ? (short)1 : DBNull.Value,
            });
            insert.Parameters.Add(new SqlParameter("slug", SqlDbType.NVarChar) { Value = slug });
            insert.Parameters.Add(new SqlParameter("name", SqlDbType.NVarChar) { Value = name });
            insert.Parameters.AddWithValue("sort", request.SortOrder ?? 0);
            id = (int)(await insert.ExecuteScalarAsync(ct))!;
        }
        catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            /* Slugs are unique across both levels, so "Dentists" as a subcategory of Health
               collides with a top-level "Dentists" too. Say which name, because the admin typed a
               name and the clash is on something derived from it. */
            return Results.Problem(
                $"A category with the web address '{slug}' already exists. Use a different name.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "taxonomy.category_created", "category",
            id.ToString(System.Globalization.CultureInfo.InvariantCulture), http,
            new { slug, name, level, parentId = request.ParentId }, ct);
        await tx.CommitAsync(ct);

        return Results.Created(
            $"/api/v1/admin/categories/{id}",
            new CategoryDto(id, level, request.ParentId, slug, name, request.SortOrder ?? 0, true, 0, []));
    }

    private static async Task<IResult> UpdateCategory(
        int id,
        CategoryUpdateRequest request,
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

        string? name = null;
        if (request.Name is not null)
        {
            if (!TryReadName(request.Name, out name, out var nameError))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [nameError] });
            }
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        /* COALESCE leaves a field alone when the request omitted it, so this one statement serves
           "rename", "reorder" and "retire" without three endpoints. The slug is absent on purpose. */
        await using (var update = new SqlCommand(
            @"UPDATE dbo.categories
              SET name = COALESCE(@name, name),
                  sort_order = COALESCE(@sort, sort_order),
                  is_active = COALESCE(@active, is_active),
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            update.Parameters.Add(new SqlParameter("name", SqlDbType.NVarChar) { Value = (object?)name ?? DBNull.Value });
            update.Parameters.Add(new SqlParameter("sort", SqlDbType.Int) { Value = (object?)request.SortOrder ?? DBNull.Value });
            update.Parameters.Add(new SqlParameter("active", SqlDbType.Bit) { Value = (object?)request.IsActive ?? DBNull.Value });
            if (await update.ExecuteNonQueryAsync(ct) == 0)
            {
                return Results.NotFound();
            }
        }

        /* Retiring a parent has to take its subcategories with it. Leaving them active would leave
           the public site offering a subcategory whose parent has gone: reachable by URL, missing
           from every list that walks down from the top. Turning a parent back on does not turn its
           children back on, because they may have been retired one by one on purpose. */
        var cascaded = 0;
        if (request.IsActive == false)
        {
            await using var children = new SqlCommand(
                "UPDATE dbo.categories SET is_active = 0, updated_at = SYSDATETIMEOFFSET() WHERE parent_id = @id AND is_active = 1",
                conn, tx);
            children.Parameters.AddWithValue("id", id);
            cascaded = await children.ExecuteNonQueryAsync(ct);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "taxonomy.category_updated", "category",
            id.ToString(System.Globalization.CultureInfo.InvariantCulture), http,
            new { name, sortOrder = request.SortOrder, isActive = request.IsActive, subcategoriesRetired = cascaded }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    /// <summary>
    /// Deletes a category nothing points at. A category with listings on it, or a parent with
    /// subcategories, is refused with the count — retiring it is the way to take it off the site.
    /// </summary>
    private static async Task<IResult> DeleteCategory(
        int id,
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

        string slug;
        long listings;
        long children;
        await using (var find = new SqlCommand(
            @"SELECT c.slug,
                     (SELECT COUNT_BIG(*) FROM dbo.listing_categories lc WHERE lc.category_id = c.id),
                     (SELECT COUNT_BIG(*) FROM dbo.categories k WHERE k.parent_id = c.id)
              FROM dbo.categories c WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE c.id = @id", conn, tx))
        {
            find.Parameters.AddWithValue("id", id);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.NotFound();
            }
            slug = reader.GetString(0);
            listings = reader.GetInt64(1);
            children = reader.GetInt64(2);
        }

        if (children > 0)
        {
            return Results.Problem(
                $"This category still has {children} subcategor{(children == 1 ? "y" : "ies")}. Delete or move those first, or switch it off instead.",
                statusCode: StatusCodes.Status409Conflict);
        }

        if (listings > 0)
        {
            return Results.Problem(
                $"{listings} listing{(listings == 1 ? "" : "s")} use this category. Switch it off instead of deleting it, so those listings keep working.",
                statusCode: StatusCodes.Status409Conflict);
        }

        // category_search_terms cascades from categories, and holds only derived search words.
        await using (var delete = new SqlCommand("DELETE FROM dbo.categories WHERE id = @id", conn, tx))
        {
            delete.Parameters.AddWithValue("id", id);
            await delete.ExecuteNonQueryAsync(ct);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "taxonomy.category_deleted", "category",
            id.ToString(System.Globalization.CultureInfo.InvariantCulture), http, new { slug }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    // ================================================================= cities and localities
    /// <summary>The cities a locality can belong to. Today that is Hyderabad; the schema allows more.</summary>
    private static async Task<IResult> ListCities(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var command = db.CreateCommand(
            "SELECT id, slug, name, state, is_active FROM dbo.cities ORDER BY name");
        var cities = new List<CityDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            cities.Add(new CityDto(
                reader.GetInt32(0), reader.GetString(1), reader.GetString(2),
                reader.GetString(3), reader.GetBoolean(4)));
        }
        return Results.Ok(cities);
    }

    private static async Task<IResult> ListLocalities(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var command = db.CreateCommand(
            @"SELECT l.id, l.city_id, c.slug, l.slug, l.name, l.center.Lat, l.center.Long,
                     l.pincode, l.is_active,
                     (SELECT COUNT_BIG(*) FROM dbo.listings li WHERE li.locality_id = l.id)
              FROM dbo.localities l
              JOIN dbo.cities c ON c.id = l.city_id
              ORDER BY c.name, l.name");

        var localities = new List<LocalityDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            localities.Add(new LocalityDto(
                reader.GetInt32(0),
                reader.GetInt32(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetDouble(5),
                reader.GetDouble(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.GetBoolean(8),
                (int)reader.GetInt64(9)));
        }
        return Results.Ok(localities);
    }

    private static async Task<IResult> CreateLocality(
        LocalityCreateRequest request,
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

        var errors = new Dictionary<string, string[]>();
        if (!TryReadName(request.Name, out var name, out var nameError))
        {
            errors["name"] = [nameError];
        }
        if (string.IsNullOrWhiteSpace(request.CitySlug))
        {
            errors["citySlug"] = ["Choose a city."];
        }
        if (!TryReadPoint(request.Latitude, request.Longitude, out var latitude, out var longitude, out var pointError))
        {
            errors["latitude"] = [pointError];
        }
        if (!TryReadPincode(request.Pincode, out var pincode, out var pincodeError))
        {
            errors["pincode"] = [pincodeError];
        }
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        if (!TryReadSlug(name, out var slug, out var slugError))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [slugError] });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        int cityId;
        await using (var city = new SqlCommand("SELECT id FROM dbo.cities WHERE slug = @slug", conn, tx))
        {
            city.Parameters.Add(new SqlParameter("slug", SqlDbType.NVarChar) { Value = request.CitySlug });
            if (await city.ExecuteScalarAsync(ct) is not int found)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["citySlug"] = ["That city does not exist."],
                });
            }
            cityId = found;
        }

        int id;
        try
        {
            /* 4326 is WGS 84 -- the same SRID the rest of the schema uses, and the one latitude and
               longitude from a map are expressed in. Point() takes latitude first. */
            await using var insert = new SqlCommand(
                @"INSERT INTO dbo.localities (city_id, slug, name, center, pincode)
                  OUTPUT INSERTED.id
                  VALUES (@city, @slug, @name, geography::Point(@lat, @long, 4326), @pincode)", conn, tx);
            insert.Parameters.AddWithValue("city", cityId);
            insert.Parameters.Add(new SqlParameter("slug", SqlDbType.NVarChar) { Value = slug });
            insert.Parameters.Add(new SqlParameter("name", SqlDbType.NVarChar) { Value = name });
            insert.Parameters.AddWithValue("lat", latitude);
            insert.Parameters.AddWithValue("long", longitude);
            insert.Parameters.Add(new SqlParameter("pincode", SqlDbType.NVarChar) { Value = (object?)pincode ?? DBNull.Value });
            id = (int)(await insert.ExecuteScalarAsync(ct))!;
        }
        catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
        {
            return Results.Problem(
                $"This city already has an area with the web address '{slug}'. Use a different name.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "taxonomy.locality_created", "locality",
            id.ToString(System.Globalization.CultureInfo.InvariantCulture), http,
            new { slug, name, citySlug = request.CitySlug }, ct);
        await tx.CommitAsync(ct);

        return Results.Created(
            $"/api/v1/admin/localities/{id}",
            new LocalityDto(id, cityId, request.CitySlug!, slug, name, latitude, longitude, pincode, true, 0));
    }

    private static async Task<IResult> UpdateLocality(
        int id,
        LocalityUpdateRequest request,
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

        var errors = new Dictionary<string, string[]>();
        string? name = null;
        if (request.Name is not null && !TryReadName(request.Name, out name, out var nameError))
        {
            errors["name"] = [nameError];
        }
        if (!TryReadPincode(request.Pincode, out var pincode, out var pincodeError))
        {
            errors["pincode"] = [pincodeError];
        }

        // Latitude and longitude move together or not at all: half a coordinate is not a place.
        var movingCentre = request.Latitude is not null || request.Longitude is not null;
        double latitude = 0, longitude = 0;
        if (movingCentre && !TryReadPoint(request.Latitude, request.Longitude, out latitude, out longitude, out var pointError))
        {
            errors["latitude"] = [pointError];
        }
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var update = new SqlCommand(
            @"UPDATE dbo.localities
              SET name = COALESCE(@name, name),
                  center = CASE WHEN @move = 1 THEN geography::Point(@lat, @long, 4326) ELSE center END,
                  pincode = CASE WHEN @clearPincode = 1 THEN NULL ELSE COALESCE(@pincode, pincode) END,
                  is_active = COALESCE(@active, is_active),
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            update.Parameters.Add(new SqlParameter("name", SqlDbType.NVarChar) { Value = (object?)name ?? DBNull.Value });
            update.Parameters.AddWithValue("move", movingCentre);
            update.Parameters.AddWithValue("lat", latitude);
            update.Parameters.AddWithValue("long", longitude);
            // An empty string means "remove the pincode"; omitting the field leaves it alone.
            update.Parameters.AddWithValue("clearPincode", request.Pincode is not null && pincode is null);
            update.Parameters.Add(new SqlParameter("pincode", SqlDbType.NVarChar) { Value = (object?)pincode ?? DBNull.Value });
            update.Parameters.Add(new SqlParameter("active", SqlDbType.Bit) { Value = (object?)request.IsActive ?? DBNull.Value });
            if (await update.ExecuteNonQueryAsync(ct) == 0)
            {
                return Results.NotFound();
            }
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "taxonomy.locality_updated", "locality",
            id.ToString(System.Globalization.CultureInfo.InvariantCulture), http,
            new { name, movedCentre = movingCentre, isActive = request.IsActive }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    /// <summary>
    /// Deletes an area no listing sits in. Refused otherwise: `listings.locality_id` has no cascade,
    /// so the database would refuse anyway — but a counted explanation is more use than an FK error,
    /// and retiring the area does what the admin actually wanted.
    /// </summary>
    private static async Task<IResult> DeleteLocality(
        int id,
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

        string slug;
        long listings;
        long serviceAreas;
        await using (var find = new SqlCommand(
            @"SELECT l.slug,
                     (SELECT COUNT_BIG(*) FROM dbo.listings li WHERE li.locality_id = l.id),
                     (SELECT COUNT_BIG(*) FROM dbo.listing_service_areas sa WHERE sa.locality_id = l.id)
              FROM dbo.localities l WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE l.id = @id", conn, tx))
        {
            find.Parameters.AddWithValue("id", id);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.NotFound();
            }
            slug = reader.GetString(0);
            listings = reader.GetInt64(1);
            serviceAreas = reader.GetInt64(2);
        }

        if (listings > 0)
        {
            return Results.Problem(
                $"{listings} listing{(listings == 1 ? " is" : "s are")} in this area. Switch it off instead of deleting it, so those listings keep working.",
                statusCode: StatusCodes.Status409Conflict);
        }

        if (serviceAreas > 0)
        {
            return Results.Problem(
                $"{serviceAreas} listing{(serviceAreas == 1 ? "" : "s")} name this area as somewhere they serve. Switch it off instead.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await using (var delete = new SqlCommand("DELETE FROM dbo.localities WHERE id = @id", conn, tx))
        {
            delete.Parameters.AddWithValue("id", id);
            await delete.ExecuteNonQueryAsync(ct);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "taxonomy.locality_deleted", "locality",
            id.ToString(System.Globalization.CultureInfo.InvariantCulture), http, new { slug }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    // ---- shared validation ---------------------------------------------------------------------
    private const int NameMaxLength = 200;

    private static bool TryReadName(string? value, out string name, out string error)
    {
        name = (value ?? string.Empty).Trim();
        if (name.Length < 2)
        {
            error = "Enter a name of at least 2 characters.";
            return false;
        }
        if (name.Length > NameMaxLength)
        {
            error = $"Keep the name to {NameMaxLength} characters or fewer.";
            return false;
        }
        error = string.Empty;
        return true;
    }

    /// <summary>
    /// The web address this name becomes. SlugGenerator falls back to "business" when a name has no
    /// ASCII letters or digits at all — fine for a listing that must get some URL, wrong for a
    /// category, where it would silently create "business" and then collide with the next one. So
    /// the name is checked first and such a name is refused.
    /// </summary>
    private static bool TryReadSlug(string name, out string slug, out string error)
    {
        if (!name.Any(char.IsAsciiLetterOrDigit))
        {
            slug = string.Empty;
            error = "Include some English letters or digits: the web address is built from them.";
            return false;
        }
        slug = SlugGenerator.FromName(name);
        error = string.Empty;
        return true;
    }

    /// <summary>
    /// A centre point, checked against the real ranges rather than only for presence: a swapped pair
    /// (17.4 typed as the longitude) lands in the sea and every "near me" result goes with it.
    /// </summary>
    private static bool TryReadPoint(
        double? latitude, double? longitude, out double lat, out double lng, out string error)
    {
        lat = latitude ?? 0;
        lng = longitude ?? 0;

        if (latitude is null || longitude is null)
        {
            error = "Enter both a latitude and a longitude.";
            return false;
        }
        if (double.IsNaN(lat) || double.IsNaN(lng) || lat is < -90 or > 90 || lng is < -180 or > 180)
        {
            error = "Enter a latitude between -90 and 90 and a longitude between -180 and 180.";
            return false;
        }
        error = string.Empty;
        return true;
    }

    /// <summary>Null stays null (the column is optional); an empty string means "clear it".</summary>
    private static bool TryReadPincode(string? value, out string? pincode, out string error)
    {
        pincode = null;
        error = string.Empty;

        if (value is null)
        {
            return true;
        }

        var trimmed = value.Trim();
        if (trimmed.Length == 0)
        {
            return true;
        }
        if (trimmed.Length != 6 || !trimmed.All(char.IsAsciiDigit))
        {
            error = "A pincode is 6 digits.";
            return false;
        }
        pincode = trimmed;
        return true;
    }
}
