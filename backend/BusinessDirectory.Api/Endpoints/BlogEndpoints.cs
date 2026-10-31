using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// The blog: public reading under /api/v1/public/blog, writing under /api/v1/admin/blog.
///
/// Both live here because they are the same rows seen from two sides, and keeping them together is
/// what makes it obvious that the public query filters on status and the admin one does not. That
/// one difference is the entire security boundary of this feature, and it is easier to keep right
/// when both halves are on the same screen.
///
/// The body is Markdown, stored as written (S0023). It is NOT rendered here: the API returns the
/// source and the website renders it, because the renderer has to escape raw HTML and that is a
/// frontend concern where the escaping rules and the output format already live.
/// </summary>
public static class BlogEndpoints
{
    public const int MaxTitleLength = 300;
    public const int MaxExcerptLength = 500;
    public const int DefaultPageSize = 12;

    public sealed record PostSummaryDto(
        long Id, string Slug, string Title, string? Excerpt, string? CoverImageUrl,
        string AuthorName, DateTimeOffset? PublishedAt, string Status);

    public sealed record PostDto(
        long Id, string Slug, string Title, string? Excerpt, string BodyMarkdown,
        string? CoverImageUrl, string AuthorName, DateTimeOffset? PublishedAt, string Status);

    public sealed record PostPageDto(IReadOnlyList<PostSummaryDto> Items, int Page, int TotalPages, int Total);

    public sealed record PostRequest(
        string? Title, string? Excerpt, string? BodyMarkdown, string? CoverImageUrl, bool Publish);

    // ------------------------------------------------------------------ public
    public static RouteGroupBuilder MapPublicBlogEndpoints(this RouteGroupBuilder publicGroup)
    {
        publicGroup.MapGet("/blog", ListPublished);
        publicGroup.MapGet("/blog/{slug}", GetPublished);
        return publicGroup;
    }

    /// <summary>
    /// Published posts, newest first. The filtered index from S0023 covers exactly this query.
    /// </summary>
    private static async Task<IResult> ListPublished(SqlDatabase db, CancellationToken ct, int? page = null)
    {
        var currentPage = page is > 0 ? page.Value : 1;

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"WITH matched AS (
                SELECT id, slug, title, excerpt, cover_image_url, author_name, published_at, status,
                       COUNT_BIG(*) OVER () AS total
                FROM dbo.blog_posts
                WHERE status = 'published' AND published_at <= SYSDATETIMEOFFSET()
              )
              SELECT id, slug, title, excerpt, cover_image_url, author_name, published_at, status, total
              FROM matched
              ORDER BY published_at DESC, id DESC
              OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY", conn);
        command.Parameters.AddWithValue("skip", (currentPage - 1) * DefaultPageSize);
        command.Parameters.AddWithValue("take", DefaultPageSize);

        var (items, total) = await ReadSummaries(command, ct);
        var totalPages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)DefaultPageSize);
        return Results.Ok(new PostPageDto(items, currentPage, totalPages, (int)total));
    }

    private static async Task<IResult> GetPublished(string slug, SqlDatabase db, CancellationToken ct)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"SELECT id, slug, title, excerpt, body_markdown, cover_image_url, author_name,
                     published_at, status
              FROM dbo.blog_posts
              WHERE slug = @slug AND status = 'published' AND published_at <= SYSDATETIMEOFFSET()", conn);
        command.Parameters.AddWithValue("slug", slug);

        await using var reader = await command.ExecuteReaderAsync(ct);
        // A draft answers 404 here, exactly as a post that does not exist does: whether something
        // unpublished is being written is not public information.
        return await reader.ReadAsync(ct) ? Results.Ok(ReadPost(reader)) : Results.NotFound();
    }

    // ------------------------------------------------------------------ admin
    public static RouteGroupBuilder MapAdminBlogEndpoints(this RouteGroupBuilder admin)
    {
        var group = admin.MapGroup("/blog");
        group.MapGet("", ListAll);
        group.MapGet("/{id:long}", GetAny);
        group.MapPost("", Create);
        group.MapPut("/{id:long}", Update);
        group.MapPost("/{id:long}/publish", Publish);
        group.MapPost("/{id:long}/unpublish", Unpublish);
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
        return (admin, AdminAccess.Authorize(admin, AdminPermissions.BlogManage));
    }

    /// <summary>Every post, drafts included, newest first by when it was last touched.</summary>
    private static async Task<IResult> ListAll(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct, int? page = null)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var currentPage = page is > 0 ? page.Value : 1;

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"WITH matched AS (
                SELECT id, slug, title, excerpt, cover_image_url, author_name, published_at, status,
                       updated_at, COUNT_BIG(*) OVER () AS total
                FROM dbo.blog_posts
              )
              SELECT id, slug, title, excerpt, cover_image_url, author_name, published_at, status, total
              FROM matched
              ORDER BY updated_at DESC, id DESC
              OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY", conn);
        command.Parameters.AddWithValue("skip", (currentPage - 1) * DefaultPageSize);
        command.Parameters.AddWithValue("take", DefaultPageSize);

        var (items, total) = await ReadSummaries(command, ct);
        var totalPages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)DefaultPageSize);
        return Results.Ok(new PostPageDto(items, currentPage, totalPages, (int)total));
    }

    private static async Task<IResult> GetAny(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"SELECT id, slug, title, excerpt, body_markdown, cover_image_url, author_name,
                     published_at, status
              FROM dbo.blog_posts WHERE id = @id", conn);
        command.Parameters.AddWithValue("id", id);

        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? Results.Ok(ReadPost(reader)) : Results.NotFound();
    }

    private static async Task<IResult> Create(
        PostRequest request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var title = request.Title?.Trim() ?? string.Empty;
        var body = request.BodyMarkdown?.Trim() ?? string.Empty;
        if (Validate(title, body) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var slug = await FreeSlug(conn, tx, title, ct);

        long newId;
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.blog_posts
                  (slug, title, excerpt, body_markdown, cover_image_url, status,
                   published_at, author_admin_id, author_name)
              OUTPUT INSERTED.id
              VALUES (@slug, @title, @excerpt, @body, @cover, @status, @publishedAt, @adminId, @author)",
            conn, tx))
        {
            insert.Parameters.AddWithValue("slug", slug);
            insert.Parameters.AddWithValue("title", title);
            insert.Parameters.AddWithValue("excerpt", (object?)Clean(request.Excerpt, MaxExcerptLength) ?? DBNull.Value);
            insert.Parameters.AddWithValue("body", body);
            insert.Parameters.AddWithValue("cover", (object?)Clean(request.CoverImageUrl, 500) ?? DBNull.Value);
            insert.Parameters.AddWithValue("status", request.Publish ? "published" : "draft");
            insert.Parameters.AddWithValue(
                "publishedAt", request.Publish ? DateTimeOffset.UtcNow : (object)DBNull.Value);
            insert.Parameters.AddWithValue("adminId", admin!.Id);
            insert.Parameters.AddWithValue("author", admin.DisplayName);
            newId = (long)(await insert.ExecuteScalarAsync(ct))!;
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "blog.created", "blog_post", newId.ToString(), http,
            new { slug, published = request.Publish }, ct);

        await tx.CommitAsync(ct);
        return Results.Created($"/api/v1/admin/blog/{newId}", new { id = newId, slug });
    }

    private static async Task<IResult> Update(
        long id, PostRequest request, ClaimsPrincipal principal, HttpContext http,
        SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var title = request.Title?.Trim() ?? string.Empty;
        var body = request.BodyMarkdown?.Trim() ?? string.Empty;
        if (Validate(title, body) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        /* The slug is never changed by an edit. It is the post's public address, and a published
           post whose URL moves is a broken link everywhere it was shared -- the same rule listings
           follow. */
        int affected;
        await using (var update = new SqlCommand(
            @"UPDATE dbo.blog_posts
              SET title = @title, excerpt = @excerpt, body_markdown = @body,
                  cover_image_url = @cover, updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            update.Parameters.AddWithValue("title", title);
            update.Parameters.AddWithValue("excerpt", (object?)Clean(request.Excerpt, MaxExcerptLength) ?? DBNull.Value);
            update.Parameters.AddWithValue("body", body);
            update.Parameters.AddWithValue("cover", (object?)Clean(request.CoverImageUrl, 500) ?? DBNull.Value);
            affected = await update.ExecuteNonQueryAsync(ct);
        }

        if (affected == 0)
        {
            return Results.NotFound();
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "blog.updated", "blog_post", id.ToString(), http, new { }, ct);

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    private static Task<IResult> Publish(
        long id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        SetPublished(id, true, principal, http, db, ct);

    private static Task<IResult> Unpublish(
        long id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        SetPublished(id, false, principal, http, db, ct);

    private static async Task<IResult> SetPublished(
        long id, bool publishing, ClaimsPrincipal principal, HttpContext http,
        SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        /* published_at is set on first publish and kept afterwards: un-publishing and re-publishing
           a post should not move it to the top of the blog as though it were new. S0023's CHECK
           requires a published post to have a date, which COALESCE guarantees. */
        int affected;
        await using (var update = new SqlCommand(
            @"UPDATE dbo.blog_posts
              SET status = @status,
                  published_at = CASE WHEN @publishing = 1
                                      THEN COALESCE(published_at, SYSDATETIMEOFFSET())
                                      ELSE published_at END,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            update.Parameters.AddWithValue("status", publishing ? "published" : "draft");
            update.Parameters.AddWithValue("publishing", publishing);
            affected = await update.ExecuteNonQueryAsync(ct);
        }

        if (affected == 0)
        {
            return Results.NotFound();
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, publishing ? "blog.published" : "blog.unpublished",
            "blog_post", id.ToString(), http, new { }, ct);

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    // ------------------------------------------------------------------ shared
    public static Dictionary<string, string[]>? Validate(string title, string body)
    {
        var errors = new Dictionary<string, string[]>();

        if (title.Length == 0)
        {
            errors["title"] = ["Give the post a title."];
        }
        else if (title.Length > MaxTitleLength)
        {
            errors["title"] = [$"Keep the title under {MaxTitleLength} characters."];
        }

        if (body.Length == 0)
        {
            errors["bodyMarkdown"] = ["Write something."];
        }

        return errors.Count > 0 ? errors : null;
    }

    /// <summary>
    /// A slug from the title, with a suffix if it is taken. Uniqueness is across every post
    /// whatever its status, because a draft must not be able to claim a published post's address
    /// and break it the moment it goes live.
    /// </summary>
    private static async Task<string> FreeSlug(
        SqlConnection conn, SqlTransaction tx, string title, CancellationToken ct)
    {
        var baseSlug = SlugGenerator.FromName(title);

        await using var command = new SqlCommand(
            "SELECT slug FROM dbo.blog_posts WHERE slug = @base OR slug LIKE @prefix", conn, tx);
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

    private static string? Clean(string? value, int max)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }
        return trimmed.Length > max ? trimmed[..max] : trimmed;
    }

    private static async Task<(List<PostSummaryDto> Items, long Total)> ReadSummaries(
        SqlCommand command, CancellationToken ct)
    {
        var items = new List<PostSummaryDto>();
        long total = 0;

        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new PostSummaryDto(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetDateTimeOffset(6),
                reader.GetString(7)));
            total = reader.GetInt64(8);
        }

        return (items, total);
    }

    private static PostDto ReadPost(SqlDataReader r) => new(
        r.GetInt64(0),
        r.GetString(1),
        r.GetString(2),
        r.IsDBNull(3) ? null : r.GetString(3),
        r.GetString(4),
        r.IsDBNull(5) ? null : r.GetString(5),
        r.GetString(6),
        r.IsDBNull(7) ? null : r.GetDateTimeOffset(7),
        r.GetString(8));
}
