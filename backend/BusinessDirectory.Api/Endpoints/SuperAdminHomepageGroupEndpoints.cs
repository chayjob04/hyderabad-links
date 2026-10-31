using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Named shelves for the homepage, under /api/v1/super-admin/homepage-groups.
///
/// The original site did not have one Featured shelf; it had several, each with a title somebody
/// wrote — "Best Cafes in Madhapur" and so on. A group is an editorial statement, so it is a row
/// with a title rather than a layout setting.
///
/// S0022's single default shelf is untouched. A featured listing with no group lands in it, which
/// is what every currently-featured listing does, so turning this on moves nothing.
///
/// Same permission as featuring itself (<c>listings.feature</c>): deciding what the platform
/// recommends and deciding what to call that recommendation are the same job, and splitting them
/// would mean somebody could name a shelf they are not allowed to fill.
/// </summary>
public static class SuperAdminHomepageGroupEndpoints
{
    /// <summary>
    /// How many groups may be active at once. The homepage is a page, not a directory of shelves:
    /// past four the page stops being a front door and becomes a second search result.
    /// </summary>
    public const int MaxActiveGroups = 4;

    public sealed record GroupDto(
        int Id, string Slug, string Title, string? Subtitle, int SortOrder, bool IsActive, int ListingCount);

    public sealed record GroupRequest(string? Title, string? Subtitle, int? SortOrder, bool IsActive);

    public sealed record GroupListDto(IReadOnlyList<GroupDto> Items, int MaxActive);

    public static RouteGroupBuilder MapSuperAdminHomepageGroupEndpoints(this RouteGroupBuilder super)
    {
        var group = super.MapGroup("/homepage-groups");
        group.MapGet("", List);
        group.MapPost("", Create);
        group.MapPut("/{id:int}", Update);
        group.MapDelete("/{id:int}", Delete);
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
        return (admin, AdminAccess.AuthorizeSuper(admin, AdminPermissions.ListingsFeature));
    }

    /// <summary>
    /// Every group with how many listings sit in it, so an empty shelf is visible before a visitor
    /// finds it rather than after.
    /// </summary>
    private static async Task<IResult> List(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"SELECT g.id, g.slug, g.title, g.subtitle, g.sort_order, g.is_active,
                     (SELECT COUNT_BIG(*) FROM dbo.listings li
                      WHERE li.homepage_group_id = g.id AND li.featured_at IS NOT NULL)
              FROM dbo.homepage_groups g
              ORDER BY g.sort_order, g.id", conn);

        var items = new List<GroupDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new GroupDto(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetInt32(4),
                reader.GetBoolean(5),
                (int)reader.GetInt64(6)));
        }

        return Results.Ok(new GroupListDto(items, MaxActiveGroups));
    }

    private static async Task<IResult> Create(
        GroupRequest request, ClaimsPrincipal principal, HttpContext http,
        SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var title = request.Title?.Trim() ?? string.Empty;
        if (Validate(title) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        if (request.IsActive && await CountActive(conn, tx, ct) >= MaxActiveGroups)
        {
            return Results.Problem(
                $"The homepage already shows {MaxActiveGroups} groups. Switch one off first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var slug = await FreeSlug(conn, tx, title, ct);

        int newId;
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.homepage_groups (slug, title, subtitle, sort_order, is_active)
              OUTPUT INSERTED.id
              VALUES (@slug, @title, @subtitle, @sort, @active)", conn, tx))
        {
            insert.Parameters.AddWithValue("slug", slug);
            insert.Parameters.AddWithValue("title", title);
            insert.Parameters.AddWithValue("subtitle", (object?)Clean(request.Subtitle) ?? DBNull.Value);
            insert.Parameters.AddWithValue("sort", request.SortOrder ?? 0);
            insert.Parameters.AddWithValue("active", request.IsActive);
            newId = (int)(await insert.ExecuteScalarAsync(ct))!;
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "homepage_group.created", "homepage_group", newId.ToString(), http,
            new { slug, title }, ct);

        await tx.CommitAsync(ct);
        return Results.Created($"/api/v1/super-admin/homepage-groups/{newId}",
            new GroupDto(newId, slug, title, Clean(request.Subtitle), request.SortOrder ?? 0, request.IsActive, 0));
    }

    /// <summary>
    /// Renames or reorders a group. The slug is never changed: it is how the group is addressed,
    /// and the same rule listings and blog posts follow.
    /// </summary>
    private static async Task<IResult> Update(
        int id, GroupRequest request, ClaimsPrincipal principal, HttpContext http,
        SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var title = request.Title?.Trim() ?? string.Empty;
        if (Validate(title) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        /* Only counted when switching a group ON, and the group itself is excluded so re-saving an
           already-active group never trips the cap. */
        if (request.IsActive && !await IsActive(conn, tx, id, ct)
            && await CountActive(conn, tx, ct) >= MaxActiveGroups)
        {
            return Results.Problem(
                $"The homepage already shows {MaxActiveGroups} groups. Switch one off first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        int affected;
        await using (var update = new SqlCommand(
            @"UPDATE dbo.homepage_groups
              SET title = @title, subtitle = @subtitle, sort_order = @sort,
                  is_active = @active, updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            update.Parameters.AddWithValue("title", title);
            update.Parameters.AddWithValue("subtitle", (object?)Clean(request.Subtitle) ?? DBNull.Value);
            update.Parameters.AddWithValue("sort", request.SortOrder ?? 0);
            update.Parameters.AddWithValue("active", request.IsActive);
            affected = await update.ExecuteNonQueryAsync(ct);
        }

        if (affected == 0)
        {
            return Results.NotFound();
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "homepage_group.updated", "homepage_group", id.ToString(), http,
            new { title, active = request.IsActive }, ct);

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    /// <summary>
    /// Removes a group. Its listings stay featured and fall back to the default shelf — the
    /// foreign key is ON DELETE SET NULL for exactly this reason. Deleting a shelf is a decision
    /// about presentation; un-featuring businesses somebody chose is a different decision, and
    /// making one silently perform the other is how curation gets undone by accident.
    /// </summary>
    private static async Task<IResult> Delete(
        int id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        int returned;
        await using (var count = new SqlCommand(
            "SELECT COUNT_BIG(*) FROM dbo.listings WHERE homepage_group_id = @id", conn, tx))
        {
            count.Parameters.AddWithValue("id", id);
            returned = (int)(long)(await count.ExecuteScalarAsync(ct))!;
        }

        // Audited before the delete, inside the same transaction, so the record cannot be lost
        // with the row -- the same ordering SuperAdminListingEndpoints uses for a listing.
        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "homepage_group.deleted", "homepage_group", id.ToString(), http,
            new { listingsReturnedToDefaultShelf = returned }, ct);

        await using (var command = new SqlCommand("DELETE FROM dbo.homepage_groups WHERE id = @id", conn, tx))
        {
            command.Parameters.AddWithValue("id", id);
            await command.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    public static Dictionary<string, string[]>? Validate(string title)
    {
        if (title.Length == 0)
        {
            return new Dictionary<string, string[]> { ["title"] = ["Give the shelf a heading."] };
        }
        if (title.Length > 160)
        {
            return new Dictionary<string, string[]> { ["title"] = ["Keep the heading under 160 characters."] };
        }
        return null;
    }

    private static string? Clean(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static async Task<int> CountActive(SqlConnection conn, SqlTransaction tx, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "SELECT COUNT_BIG(*) FROM dbo.homepage_groups WITH (UPDLOCK) WHERE is_active = 1", conn, tx);
        return (int)(long)(await command.ExecuteScalarAsync(ct))!;
    }

    private static async Task<bool> IsActive(SqlConnection conn, SqlTransaction tx, int id, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "SELECT TOP (1) 1 FROM dbo.homepage_groups WHERE id = @id AND is_active = 1", conn, tx);
        command.Parameters.AddWithValue("id", id);
        return await command.ExecuteScalarAsync(ct) is not null;
    }

    private static async Task<string> FreeSlug(
        SqlConnection conn, SqlTransaction tx, string title, CancellationToken ct)
    {
        var baseSlug = SlugGenerator.FromName(title);

        await using var command = new SqlCommand(
            "SELECT slug FROM dbo.homepage_groups WHERE slug = @base OR slug LIKE @prefix", conn, tx);
        command.Parameters.AddWithValue("base", baseSlug);
        command.Parameters.AddWithValue("prefix", baseSlug + "-%");

        var taken = new HashSet<string>(StringComparer.Ordinal);
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                taken.Add(reader.GetString(0));
            }
        }

        return SlugGenerator.NextFree(baseSlug, taken);
    }
}
