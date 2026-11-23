using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Page titles and descriptions, under /api/v1/admin/seo.
///
/// Every public page still derives its own metadata. A row here <b>overrides</b> that; no row
/// means nothing changes. That is what makes this safe to deploy before a single override exists,
/// and it means deleting a row restores the derived value rather than leaving a blank title.
///
/// Addressing follows S0021: a listing, category or locality is identified by its id, and a static
/// page (home, terms, privacy, help) by a key, because it has no row anywhere to point at.
/// </summary>
public static class AdminSeoEndpoints
{
    /// <summary>The static pages that may be overridden. A fixed list, so a typo cannot create an
    /// override for a page nothing renders and then puzzle whoever wrote it.</summary>
    public static readonly string[] StaticPageKeys =
    [
        "home", "search", "terms", "privacy", "help", "blog", "about", "pricing",
        /* The four index screens. The website was reading an override for each of these under an
           entity_type of "page", which this table's CHECK does not allow, so the lookup could never
           match and the panel had no way to address them either. Both sides now say "static".
           Every key here must be read by a public page: scripts/check-seo-coverage.test.mjs. */
        "categories", "areas", "trending", "verified",
    ];

    public static readonly string[] EntityTypes = ["listing", "category", "locality", "static"];

    public sealed record MetaDto(
        long Id,
        string EntityType,
        long EntityId,
        string? PageKey,
        string? MetaTitle,
        string? MetaDescription,
        string? MetaKeywords,
        string? OgImageUrl,
        bool Noindex,
        DateTimeOffset UpdatedAt);

    public sealed record MetaRequest(
        string? MetaTitle, string? MetaDescription, string? MetaKeywords, string? OgImageUrl, bool Noindex);

    public sealed record MetaListDto(IReadOnlyList<MetaDto> Items, IReadOnlyList<string> StaticPages);

    /// <summary>
    /// One listing a staff member can pick, for the one entity type this panel could not address.
    /// </summary>
    /// <param name="Url">
    /// The public page, or null when the listing has no primary category yet -- it has no page to
    /// write a title for until one is set, and the panel says so rather than offering the form.
    /// </param>
    /// <param name="HasOverride">Whether a row already exists, so the list can say which are customised.</param>
    public sealed record SeoListingDto(
        long Id,
        string Name,
        string Status,
        string LocalityName,
        string? CategoryName,
        string? Url,
        bool HasOverride);

    public sealed record SeoListingSearchDto(IReadOnlyList<SeoListingDto> Items, int Total, bool Truncated);

    /// <summary>How many matches are worth showing before the answer is "type more".</summary>
    public const int SearchLimit = 20;

    public static RouteGroupBuilder MapAdminSeoEndpoints(this RouteGroupBuilder admin)
    {
        var group = admin.MapGroup("/seo");
        group.MapGet("", List);
        /* Listings are searched rather than listed. There are thousands of them, so the dropdown
           the categories and areas use is the wrong control -- which is why this entity type had
           no panel at all, although the table, the API and the public page have always supported
           it. Gated on seo.manage like everything else here, so finding a listing to write a title
           for does not require the permissions to review one. */
        group.MapGet("/listings", SearchListings);
        group.MapGet("/{entityType}/{key}", Get);
        group.MapPut("/{entityType}/{key}", Upsert);
        group.MapDelete("/{entityType}/{key}", Delete);
        return group;
    }

    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return (null, Results.Unauthorized());
        }
        return (admin, AdminAccess.Authorize(admin, AdminPermissions.SeoManage));
    }

    /// <summary>Every override that exists, so a staff member can see what has been customised.</summary>
    private static async Task<IResult> List(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"SELECT id, entity_type, entity_id, page_key, meta_title, meta_description,
                     meta_keywords, og_image_url, noindex, updated_at
              FROM dbo.page_meta
              ORDER BY entity_type, page_key, entity_id", conn);

        var items = new List<MetaDto>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                items.Add(Read(reader));
            }
        }

        return Results.Ok(new MetaListDto(items, StaticPageKeys));
    }

    /// <summary>
    /// Listings whose name matches, or the one listing whose id was typed.
    /// </summary>
    /// <remarks>
    /// An id is accepted as well as a name because the override list on the panel shows
    /// "listing #412" for rows whose listing it cannot name, and pasting that number is then the
    /// quickest way to reach it.
    ///
    /// The name match is a parameterised LIKE with the wildcards escaped, so a name containing %
    /// or [ matches itself rather than everything. There is no full-text index on this path on
    /// purpose: this is a staff lookup over a few thousand rows, and the search page's index is
    /// tuned for public queries.
    /// </remarks>
    private static async Task<IResult> SearchListings(
        string? q, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var text = Clean(q);
        if (text is null)
        {
            return Results.Ok(new SeoListingSearchDto([], 0, false));
        }

        var asId = long.TryParse(text, out var id) && id > 0 ? id : (long?)null;

        /* One character is too little to search a name on -- it would return the first twenty
           listings containing an "a" -- but it is a perfectly good id, and the first few listings
           in the directory have one. So the length rule belongs to the name match alone: null
           here means "do not match on the name", and the id still matches.

           This mattered in practice rather than in theory. The panel addresses a chosen listing by
           putting its id back in the address and looking it up again, so with one rule for both,
           every listing numbered under ten could be found by name and then not opened. Measured in
           Chrome. */
        var nameSearch = text.Length >= 2 ? "%" + Escape(text) + "%" : null;
        if (asId is null && nameSearch is null)
        {
            return Results.Ok(new SeoListingSearchDto([], 0, false));
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"WITH matches AS (
                  SELECT li.id, li.name, li.status, li.slug, lo.name AS locality_name,
                         pc.name AS category_name, pc.slug AS category_slug,
                         pcparent.slug AS parent_category_slug,
                         CASE WHEN pm.id IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS has_override
                  FROM dbo.listings li
                  JOIN dbo.localities lo ON lo.id = li.locality_id
                  LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
                  LEFT JOIN dbo.categories pc ON pc.id = lc.category_id
                  LEFT JOIN dbo.categories pcparent ON pcparent.id = pc.parent_id
                  LEFT JOIN dbo.page_meta pm ON pm.entity_type = 'listing' AND pm.entity_id = li.id
                  /* Staged edits and unsaved new listings have no public page to write a
                     title for (S0034): a staged row may never be active, which is the condition
                     every public query requires. */
                  WHERE li.staged_for_listing_id IS NULL
                    AND li.is_placeholder = 0
                    AND ((@id IS NOT NULL AND li.id = @id)
                         OR (@like IS NOT NULL AND li.name LIKE @like ESCAPE '\'))
              )
              SELECT (SELECT COUNT_BIG(*) FROM matches) AS total,
                     m.id, m.name, m.status, m.slug, m.locality_name,
                     m.category_name, m.category_slug, m.parent_category_slug, m.has_override
              FROM (SELECT 1 AS one) AS always_one_row
              LEFT JOIN (
                  SELECT TOP (@limit) * FROM matches ORDER BY name ASC, id ASC
              ) m ON 1 = 1
              ORDER BY m.name ASC, m.id ASC", conn);
        command.Parameters.Add(new SqlParameter("id", SqlDbType.BigInt)
        {
            Value = asId is { } value ? value : DBNull.Value,
        });
        command.Parameters.Add(new SqlParameter("like", SqlDbType.NVarChar, 200)
        {
            Value = nameSearch is null ? DBNull.Value : nameSearch,
        });
        command.Parameters.AddWithValue("limit", SearchLimit);

        var items = new List<SeoListingDto>();
        var total = 0;
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = (int)reader.GetInt64(0);
            if (reader.IsDBNull(1))
            {
                break;   // nothing matched, and the total still says so
            }
            items.Add(new SeoListingDto(
                reader.GetInt64(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                Listings.PublicUrl.ForListing(
                    reader.IsDBNull(8) ? null : reader.GetString(8),
                    reader.IsDBNull(7) ? null : reader.GetString(7),
                    reader.GetString(4)),
                reader.GetBoolean(9)));
        }

        return Results.Ok(new SeoListingSearchDto(items, total, total > items.Count));
    }

    /// <summary>
    /// Escapes the LIKE wildcards, so a name containing % or [ matches itself.
    /// </summary>
    /// <remarks>
    /// Public so it can be tested without a database. A name like "50% Off Salon" would
    /// otherwise match every listing, and "[A] Cafe" would match none of itself -- both of which
    /// look like the search being broken rather than like a quoting mistake.
    /// </remarks>
    public static string Escape(string value) =>
        value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_").Replace("[", "\\[");

    private static async Task<IResult> Get(
        string entityType, string key, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        if (!TryAddress(entityType, key, out var entityId, out var pageKey, out var error))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["entityType"] = [error!] });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var existing = await ReadOne(conn, entityType, entityId, pageKey, ct);
        // 404 means "no override", which the caller shows as the derived value. Not an error.
        return existing is null ? Results.NotFound() : Results.Ok(existing);
    }

    /// <summary>
    /// Creates or replaces the override. One endpoint for both, because from a staff member's
    /// point of view there is one form and one Save button, and whether a row already existed is
    /// not something they should have to know.
    /// </summary>
    private static async Task<IResult> Upsert(
        string entityType, string key, MetaRequest request,
        ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        if (!TryAddress(entityType, key, out var entityId, out var pageKey, out var addressError))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["entityType"] = [addressError!] });
        }

        var title = Clean(request.MetaTitle);
        var description = Clean(request.MetaDescription);
        var keywords = Clean(request.MetaKeywords);
        var image = Clean(request.OgImageUrl);

        if (ValidateMeta(title, description, keywords, image) is { } tooLong)
        {
            return Results.ValidationProblem(tooLong);
        }

        /* An override that sets nothing would shadow the derived value with emptiness. The table's
           own CHECK refuses it; this says so in words first. */
        if (title is null && description is null && keywords is null && image is null && !request.Noindex)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["metaTitle"] = ["Set at least one field, or delete the override to go back to the default."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        /* MERGE is avoided throughout this project; a delete-then-insert inside one transaction is
           easier to read and has the same effect, and the unique index makes a duplicate
           impossible either way. */
        await using (var clear = new SqlCommand(
            @"DELETE FROM dbo.page_meta
              WHERE entity_type = @type AND entity_id = @id
                AND ((page_key IS NULL AND @key IS NULL) OR page_key = @key)", conn, tx))
        {
            clear.Parameters.AddWithValue("type", entityType);
            clear.Parameters.AddWithValue("id", entityId);
            clear.Parameters.AddWithValue("key", (object?)pageKey ?? DBNull.Value);
            await clear.ExecuteNonQueryAsync(ct);
        }

        long newId;
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.page_meta
                  (entity_type, entity_id, page_key, meta_title, meta_description,
                   meta_keywords, og_image_url, noindex, updated_by_admin_id)
              OUTPUT INSERTED.id
              VALUES (@type, @id, @key, @title, @description, @keywords, @image, @noindex, @admin)", conn, tx))
        {
            insert.Parameters.AddWithValue("type", entityType);
            insert.Parameters.AddWithValue("id", entityId);
            insert.Parameters.AddWithValue("key", (object?)pageKey ?? DBNull.Value);
            insert.Parameters.AddWithValue("title", (object?)title ?? DBNull.Value);
            insert.Parameters.AddWithValue("description", (object?)description ?? DBNull.Value);
            insert.Parameters.AddWithValue("keywords", (object?)keywords ?? DBNull.Value);
            insert.Parameters.AddWithValue("image", (object?)image ?? DBNull.Value);
            insert.Parameters.AddWithValue("noindex", request.Noindex);
            insert.Parameters.AddWithValue("admin", admin!.Id);
            newId = (long)(await insert.ExecuteScalarAsync(ct))!;
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "seo.updated", entityType, pageKey ?? entityId.ToString(), http,
            new { noindex = request.Noindex }, ct);

        await tx.CommitAsync(ct);

        await using var after = await db.OpenConnectionAsync(ct);
        return Results.Ok(await ReadOne(after, entityType, entityId, pageKey, ct) ?? new MetaDto(
            newId, entityType, entityId, pageKey, title, description, keywords, image,
            request.Noindex, DateTimeOffset.UtcNow));
    }

    /// <summary>Removes the override, so the page goes back to the metadata it derives for itself.</summary>
    private static async Task<IResult> Delete(
        string entityType, string key, ClaimsPrincipal principal, HttpContext http,
        SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        if (!TryAddress(entityType, key, out var entityId, out var pageKey, out var error))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["entityType"] = [error!] });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var command = new SqlCommand(
            @"DELETE FROM dbo.page_meta
              WHERE entity_type = @type AND entity_id = @id
                AND ((page_key IS NULL AND @key IS NULL) OR page_key = @key)", conn, tx))
        {
            command.Parameters.AddWithValue("type", entityType);
            command.Parameters.AddWithValue("id", entityId);
            command.Parameters.AddWithValue("key", (object?)pageKey ?? DBNull.Value);
            await command.ExecuteNonQueryAsync(ct);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "seo.cleared", entityType, pageKey ?? entityId.ToString(), http, new { }, ct);

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    /// <summary>
    /// Turns a URL pair into the two columns that address a row. A static page carries its key and
    /// an id of 0; everything else carries its id and no key — the arrangement S0021's CHECK
    /// enforces, applied here so a bad request is a 400 rather than a constraint violation.
    /// </summary>
    public static bool TryAddress(
        string entityType, string key, out long entityId, out string? pageKey, out string? error)
    {
        entityId = 0;
        pageKey = null;
        error = null;

        if (!EntityTypes.Contains(entityType))
        {
            error = $"Choose one of: {string.Join(", ", EntityTypes)}.";
            return false;
        }

        if (entityType == "static")
        {
            if (!StaticPageKeys.Contains(key))
            {
                error = $"Choose one of: {string.Join(", ", StaticPageKeys)}.";
                return false;
            }
            pageKey = key;
            return true;
        }

        if (!long.TryParse(key, out entityId) || entityId <= 0)
        {
            error = "That is not a valid id.";
            return false;
        }

        return true;
    }

    /// <summary>
    /// Trims, and treats an empty field as "not set" — which is what lets an admin clear one
    /// override without clearing the rest.
    ///
    /// <para>
    /// It used to truncate to the column width as well, and that is what changed. Silently storing
    /// the first 200 characters of a 250-character title is the one outcome nobody asked for: the
    /// admin sees their text accepted, the page renders a sentence cut off mid-word, and nothing
    /// anywhere says so. These are the fields search engines read, so the text being exactly what
    /// was written matters more here than almost anywhere else in the panel. Too long is now
    /// refused by <see cref="ValidateMeta"/>, with the limit named.
    /// </para>
    /// </summary>
    private static string? Clean(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    // ---- shared validation ---------------------------------------------------------------------

    /// <summary>`page_meta.meta_title` is `nvarchar(200)` in `S0021`.</summary>
    public const int MaxTitleLength = 200;

    /// <summary>`page_meta.meta_description` is `nvarchar(400)`.</summary>
    public const int MaxDescriptionLength = 400;

    /// <summary>`page_meta.meta_keywords` is `nvarchar(400)`.</summary>
    public const int MaxKeywordsLength = 400;

    /// <summary>`page_meta.og_image_url` is `nvarchar(500)`.</summary>
    public const int MaxImageUrlLength = 500;

    /// <summary>
    /// Which overrides are too long for their columns, or null when all four fit. Every field is
    /// reported at once rather than one at a time: this is one form with four boxes, and an admin
    /// fixing a long description should not have to submit again to find out the keywords are long
    /// too.
    ///
    /// A null or blank field is not an error here — that is "no override", and the separate
    /// all-four-empty rule in the handler covers the case where nothing at all is set.
    /// </summary>
    public static Dictionary<string, string[]>? ValidateMeta(
        string? title, string? description, string? keywords, string? imageUrl)
    {
        var errors = new Dictionary<string, string[]>();

        if (title is { } t && t.Length > MaxTitleLength)
        {
            errors["metaTitle"] = [$"Keep the title to {MaxTitleLength} characters or fewer."];
        }
        if (description is { } d && d.Length > MaxDescriptionLength)
        {
            errors["metaDescription"] = [$"Keep the description to {MaxDescriptionLength} characters or fewer."];
        }
        if (keywords is { } k && k.Length > MaxKeywordsLength)
        {
            errors["metaKeywords"] = [$"Keep the keywords to {MaxKeywordsLength} characters or fewer."];
        }
        if (imageUrl is { } i && i.Length > MaxImageUrlLength)
        {
            errors["ogImageUrl"] = [$"Keep the image address to {MaxImageUrlLength} characters or fewer."];
        }

        return errors.Count > 0 ? errors : null;
    }

    private static async Task<MetaDto?> ReadOne(
        SqlConnection conn, string entityType, long entityId, string? pageKey, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT id, entity_type, entity_id, page_key, meta_title, meta_description,
                     meta_keywords, og_image_url, noindex, updated_at
              FROM dbo.page_meta
              WHERE entity_type = @type AND entity_id = @id
                AND ((page_key IS NULL AND @key IS NULL) OR page_key = @key)", conn);
        command.Parameters.AddWithValue("type", entityType);
        command.Parameters.AddWithValue("id", entityId);
        command.Parameters.AddWithValue("key", (object?)pageKey ?? DBNull.Value);

        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? Read(reader) : null;
    }

    private static MetaDto Read(SqlDataReader r) => new(
        r.GetInt64(0),
        r.GetString(1),
        r.GetInt64(2),
        r.IsDBNull(3) ? null : r.GetString(3),
        r.IsDBNull(4) ? null : r.GetString(4),
        r.IsDBNull(5) ? null : r.GetString(5),
        r.IsDBNull(6) ? null : r.GetString(6),
        r.IsDBNull(7) ? null : r.GetString(7),
        r.GetBoolean(8),
        r.GetDateTimeOffset(9));
}
