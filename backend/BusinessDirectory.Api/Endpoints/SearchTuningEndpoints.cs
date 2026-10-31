using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Search synonyms and the search box placeholder, as data rather than as code.
///
/// Public reads the placeholders; admin edits both. Two small lists together, because they are the
/// same screen's worth of work and neither justifies a file of its own.
///
/// <b>Both fall back to today's behaviour when empty.</b> No placeholders means the website keeps
/// its own default text; no synonyms means a search runs exactly as it does now. That is what lets
/// these ship before anyone has written a row, and it means deactivating everything is safe rather
/// than leaving the search box blank.
///
/// Synonyms expand the term <i>before</i> it reaches the existing full-text and trigram machinery,
/// which is untouched. "medical shop" becomes "pharmacies" and then still gets typo tolerance, so
/// "medcal shop" works too.
/// </summary>
public static class SearchTuningEndpoints
{
    public sealed record SynonymDto(int Id, string Term, string MapsTo, bool IsActive);

    public sealed record SynonymRequest(string? Term, string? MapsTo, bool IsActive);

    public sealed record PlaceholderDto(int Id, string Text, int SortOrder, bool IsActive);

    public sealed record PlaceholderRequest(string? Text, int? SortOrder, bool IsActive);

    public sealed record TuningDto(IReadOnlyList<SynonymDto> Synonyms, IReadOnlyList<PlaceholderDto> Placeholders);

    // ------------------------------------------------------------------ public
    public static RouteGroupBuilder MapPublicSearchTuningEndpoints(this RouteGroupBuilder publicGroup)
    {
        publicGroup.MapGet("/search-placeholders", ListActivePlaceholders);
        return publicGroup;
    }

    /// <summary>
    /// The placeholder text the search box should show. An empty list is a valid answer and means
    /// "use your own default" — the website must not render an empty placeholder.
    /// </summary>
    private static async Task<IResult> ListActivePlaceholders(SqlDatabase db, CancellationToken ct)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"SELECT text FROM dbo.search_placeholders
              WHERE is_active = 1 ORDER BY sort_order, id", conn);

        var texts = new List<string>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            texts.Add(reader.GetString(0));
        }

        return Results.Ok(texts);
    }

    /// <summary>
    /// What a search term should be treated as, or the term unchanged when no synonym matches.
    ///
    /// Called by the search endpoint before it queries. Deliberately a single lookup rather than
    /// loading the whole table: the list is small but this runs on every search, and an exact
    /// index seek is cheaper than a cache that can go stale after an admin edits a row.
    /// </summary>
    public static async Task<string> ExpandAsync(
        SqlConnection conn, string term, CancellationToken ct)
    {
        var trimmed = term.Trim();
        if (trimmed.Length == 0)
        {
            return term;
        }

        await using var command = new SqlCommand(
            "SELECT maps_to FROM dbo.search_synonyms WHERE term = @term AND is_active = 1", conn);
        command.Parameters.AddWithValue("term", trimmed.ToLowerInvariant());

        var mapped = await command.ExecuteScalarAsync(ct) as string;
        return string.IsNullOrWhiteSpace(mapped) ? term : mapped;
    }

    // ------------------------------------------------------------------ admin
    public static RouteGroupBuilder MapAdminSearchTuningEndpoints(this RouteGroupBuilder admin)
    {
        var group = admin.MapGroup("/search");
        group.MapGet("", List);
        group.MapPost("/synonyms", AddSynonym);
        group.MapDelete("/synonyms/{id:int}", DeleteSynonym);
        group.MapPost("/placeholders", AddPlaceholder);
        group.MapDelete("/placeholders/{id:int}", DeletePlaceholder);
        return group;
    }

    /* Gated on taxonomy.manage rather than a new permission. Tuning what a search word means is
       the same editorial job as naming a category, and an admin trusted with one is trusted with
       the other; a permission per screen would make the catalogue harder to reason about without
       making anything safer. */
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

    private static async Task<IResult> List(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);

        var synonyms = new List<SynonymDto>();
        await using (var command = new SqlCommand(
            "SELECT id, term, maps_to, is_active FROM dbo.search_synonyms ORDER BY term", conn))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                synonyms.Add(new SynonymDto(
                    reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3)));
            }
        }

        var placeholders = new List<PlaceholderDto>();
        await using (var command = new SqlCommand(
            "SELECT id, text, sort_order, is_active FROM dbo.search_placeholders ORDER BY sort_order, id", conn))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                placeholders.Add(new PlaceholderDto(
                    reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2), reader.GetBoolean(3)));
            }
        }

        return Results.Ok(new TuningDto(synonyms, placeholders));
    }

    private static async Task<IResult> AddSynonym(
        SynonymRequest request, ClaimsPrincipal principal, HttpContext http,
        SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        // Lower-cased on the way in, because the lookup compares exactly and a capitalised row
        // would simply never match anything a visitor typed.
        var term = request.Term?.Trim().ToLowerInvariant() ?? string.Empty;
        var mapsTo = request.MapsTo?.Trim().ToLowerInvariant() ?? string.Empty;

        var errors = new Dictionary<string, string[]>();
        if (term.Length == 0)
        {
            errors["term"] = ["Enter the word people type."];
        }
        if (mapsTo.Length == 0)
        {
            errors["mapsTo"] = ["Enter what it should search for."];
        }
        if (errors.Count == 0 && term == mapsTo)
        {
            errors["mapsTo"] = ["That is the same word. A synonym has to point somewhere else."];
        }
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        // One meaning per term: two rows for "chemist" would make the result depend on row order.
        await using (var exists = new SqlCommand(
            "SELECT TOP (1) 1 FROM dbo.search_synonyms WHERE term = @term", conn, tx))
        {
            exists.Parameters.AddWithValue("term", term);
            if (await exists.ExecuteScalarAsync(ct) is not null)
            {
                return Results.Problem(
                    $"“{term}” already has a synonym. Remove it first.",
                    statusCode: StatusCodes.Status409Conflict);
            }
        }

        int newId;
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.search_synonyms (term, maps_to, is_active)
              OUTPUT INSERTED.id VALUES (@term, @mapsTo, @active)", conn, tx))
        {
            insert.Parameters.AddWithValue("term", term);
            insert.Parameters.AddWithValue("mapsTo", mapsTo);
            insert.Parameters.AddWithValue("active", request.IsActive);
            newId = (int)(await insert.ExecuteScalarAsync(ct))!;
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "search.synonym_added", "search_synonym", newId.ToString(), http,
            new { term, mapsTo }, ct);

        await tx.CommitAsync(ct);
        return Results.Created($"/api/v1/admin/search/synonyms/{newId}",
            new SynonymDto(newId, term, mapsTo, request.IsActive));
    }

    private static Task<IResult> DeleteSynonym(
        int id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        Remove(id, "dbo.search_synonyms", "search.synonym_removed", "search_synonym", principal, http, db, ct);

    private static async Task<IResult> AddPlaceholder(
        PlaceholderRequest request, ClaimsPrincipal principal, HttpContext http,
        SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var text = request.Text?.Trim() ?? string.Empty;
        if (text.Length == 0)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["text"] = ["Enter the text to show in the search box."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        int newId;
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.search_placeholders (text, sort_order, is_active)
              OUTPUT INSERTED.id VALUES (@text, @sort, @active)", conn, tx))
        {
            insert.Parameters.AddWithValue("text", text);
            insert.Parameters.AddWithValue("sort", request.SortOrder ?? 0);
            insert.Parameters.AddWithValue("active", request.IsActive);
            newId = (int)(await insert.ExecuteScalarAsync(ct))!;
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "search.placeholder_added", "search_placeholder", newId.ToString(),
            http, new { }, ct);

        await tx.CommitAsync(ct);
        return Results.Created($"/api/v1/admin/search/placeholders/{newId}",
            new PlaceholderDto(newId, text, request.SortOrder ?? 0, request.IsActive));
    }

    private static Task<IResult> DeletePlaceholder(
        int id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        Remove(id, "dbo.search_placeholders", "search.placeholder_removed", "search_placeholder",
            principal, http, db, ct);

    /// <summary>Both lists delete the same way. The table name is a constant from this file.</summary>
    private static async Task<IResult> Remove(
        int id, string table, string action, string entityType, ClaimsPrincipal principal,
        HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var command = new SqlCommand($"DELETE FROM {table} WHERE id = @id", conn, tx))
        {
            command.Parameters.AddWithValue("id", id);
            await command.ExecuteNonQueryAsync(ct);
        }

        await AuditLog.WriteAsync(conn, tx, admin!.Id, action, entityType, id.ToString(), http, new { }, ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }
}
