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
    public static readonly string[] StaticPageKeys = ["home", "search", "terms", "privacy", "help", "blog"];

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

    public static RouteGroupBuilder MapAdminSeoEndpoints(this RouteGroupBuilder admin)
    {
        var group = admin.MapGroup("/seo");
        group.MapGet("", List);
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

        var title = Clean(request.MetaTitle, 200);
        var description = Clean(request.MetaDescription, 400);
        var keywords = Clean(request.MetaKeywords, 400);
        var image = Clean(request.OgImageUrl, 500);

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

    private static string? Clean(string? value, int max)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }
        return trimmed.Length > max ? trimmed[..max] : trimmed;
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
