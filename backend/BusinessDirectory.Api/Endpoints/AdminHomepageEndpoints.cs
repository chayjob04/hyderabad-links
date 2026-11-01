using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// The two things staff curate on the public homepage, under /api/v1/admin. Gated on
/// <c>homepage.manage</c> (S0025).
///
///   /popular-categories — which categories lead the homepage. A flag on `categories`, so there is
///                         no second list to fall out of step with the directory: retire a category
///                         and it leaves the homepage with it.
///   /scrolling-text     — the strip across the top. Rows staff write, replacing a list the
///                         frontend derived from the category tree and nobody could change.
///
/// One permission covers both: they are the same editorial job, and splitting them would allow a
/// role that can curate half a page.
///
/// The URL rule in <see cref="NormaliseUrl"/> is the one piece of real care in this file. A line
/// here is written in an admin panel and rendered as a link on the public site, which is exactly
/// the shape of an open redirect — and of a `javascript:` payload. Only a site-relative path is
/// accepted. The database CHECK says the same thing (S0025), so a row that skipped this endpoint
/// still cannot hold one.
/// </summary>
public static class AdminHomepageEndpoints
{
    /// <summary>Longest line the strip accepts, matching `scrolling_texts.message`.</summary>
    public const int MaxMessageLength = 200;

    /// <summary>Longest path, matching `scrolling_texts.url`.</summary>
    public const int MaxUrlLength = 300;

    public sealed record ScrollingTextDto(
        int Id, string Message, string? Url, int SortOrder, bool IsActive, DateTimeOffset UpdatedAt);

    public sealed record ScrollingTextRequest(string? Message, string? Url, int? SortOrder, bool? IsActive);

    /// <summary>A category as the curation screen shows it: enough to recognise and to order.</summary>
    public sealed record PopularCategoryDto(
        int Id,
        short Level,
        string Slug,
        string Name,
        /// <summary>The top-level category this sits under, so two "Dentists" can be told apart.</summary>
        string? ParentName,
        int SortOrder,
        bool IsActive,
        bool IsPopular,
        /// <summary>Live listings on it. A popular category with none is an empty shelf, and staff should see that before choosing it.</summary>
        int ListingCount);

    public static RouteGroupBuilder MapAdminHomepageEndpoints(this RouteGroupBuilder admin)
    {
        var popular = admin.MapGroup("/popular-categories");
        popular.MapGet("", ListPopularCategories);
        popular.MapPut("/{id:int}", SetPopular);

        var strip = admin.MapGroup("/scrolling-text");
        strip.MapGet("", ListScrollingText);
        strip.MapPost("", CreateScrollingText);
        strip.MapPut("/{id:int}", UpdateScrollingText);
        strip.MapDelete("/{id:int}", DeleteScrollingText);

        return admin;
    }

    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return (null, Results.Unauthorized());
        }
        return (admin, AdminAccess.Authorize(admin, AdminPermissions.HomepageManage));
    }

    // ---- popular categories --------------------------------------------------------------------

    /// <summary>
    /// Every category, flagged or not, so the screen is one list with toggles rather than a list of
    /// what is chosen plus a separate picker for what is not.
    /// </summary>
    private static async Task<IResult> ListPopularCategories(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"SELECT c.id, c.level, c.slug, c.name, parent.name AS parent_name,
                     c.sort_order, c.is_active, c.is_popular,
                     (SELECT COUNT(*) FROM dbo.listing_categories lc
                      JOIN dbo.listings li ON li.id = lc.listing_id AND li.status = 'active'
                      WHERE lc.category_id = c.id) AS listing_count
              FROM dbo.categories c
              LEFT JOIN dbo.categories parent ON parent.id = c.parent_id
              -- Popular first so the chosen set reads as a block at the top, then the directory's
              -- own order, which is what staff already know their way around.
              ORDER BY c.is_popular DESC, c.level, parent.sort_order, c.sort_order, c.name", conn);

        var items = new List<PopularCategoryDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new PopularCategoryDto(
                reader.GetInt32(0),
                reader.GetInt16(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetInt32(5),
                reader.GetBoolean(6),
                reader.GetBoolean(7),
                reader.GetInt32(8)));
        }

        return Results.Ok(items);
    }

    public sealed record SetPopularRequest(bool? IsPopular, int? SortOrder);

    /// <summary>
    /// Flags or unflags one category, and optionally moves it. `sort_order` is the category's own,
    /// shared with the directory tree — deliberately, so there is one order to understand rather
    /// than a homepage order that disagrees with the menu.
    /// </summary>
    private static async Task<IResult> SetPopular(
        int id, SetPopularRequest? request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        if (request?.IsPopular is null && request?.SortOrder is null)
        {
            return Results.BadRequest(new { message = "Send isPopular, sortOrder, or both." });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
        await using var command = new SqlCommand(
            @"UPDATE dbo.categories
                 SET is_popular = COALESCE(@isPopular, is_popular),
                     sort_order = COALESCE(@sortOrder, sort_order)
               WHERE id = @id;
              SELECT @@ROWCOUNT;", conn, tx);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("isPopular", (object?)request.IsPopular ?? DBNull.Value);
        command.Parameters.AddWithValue("sortOrder", (object?)request.SortOrder ?? DBNull.Value);

        var changed = (int)(await command.ExecuteScalarAsync(ct) ?? 0);
        if (changed == 0)
        {
            return Results.NotFound(new { message = "No such category." });
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "category.popular", "category", id.ToString(), http,
            new { isPopular = request.IsPopular, sortOrder = request.SortOrder }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    // ---- the scrolling strip -------------------------------------------------------------------

    private static async Task<IResult> ListScrollingText(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        // Inactive rows included: this is the editing screen, and a line that is switched off is
        // still something staff need to see to switch back on.
        await using var command = new SqlCommand(
            @"SELECT id, message, url, sort_order, is_active, updated_at
              FROM dbo.scrolling_texts
              ORDER BY sort_order, id", conn);

        var items = new List<ScrollingTextDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new ScrollingTextDto(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetInt32(3),
                reader.GetBoolean(4),
                reader.GetDateTimeOffset(5)));
        }

        return Results.Ok(items);
    }

    /// <summary>
    /// The message, trimmed, or the reason it was refused.
    /// </summary>
    public static (string? Message, string? Error) NormaliseMessage(string? raw)
    {
        var message = raw?.Trim();
        if (string.IsNullOrEmpty(message))
        {
            return (null, "A line of text is required.");
        }
        if (message.Length > MaxMessageLength)
        {
            return (null, $"Keep the line to {MaxMessageLength} characters or fewer.");
        }
        return (message, null);
    }

    /// <summary>
    /// The link, or the reason it was refused. Null in and null out means "no link", which is a
    /// valid line.
    ///
    /// Only a site-relative path is allowed: it must start with a single "/". That rules out
    /// `javascript:`, `data:`, and `//evil.example` — which a browser reads as another host, not as
    /// a path — without needing a list of schemes to keep up to date. Someone who genuinely wants to
    /// point the strip off-site has to add that capability deliberately rather than by typing a URL.
    /// </summary>
    public static (string? Url, string? Error) NormaliseUrl(string? raw)
    {
        var url = raw?.Trim();
        if (string.IsNullOrEmpty(url))
        {
            return (null, null);
        }
        if (url.Length > MaxUrlLength)
        {
            return (null, $"Keep the link to {MaxUrlLength} characters or fewer.");
        }
        if (!url.StartsWith('/') || url.StartsWith("//", StringComparison.Ordinal) || url.Length < 2)
        {
            return (null, "A link must be a path on this site, starting with a single \"/\" — for example /verified.");
        }
        return (url, null);
    }

    private static async Task<IResult> CreateScrollingText(
        ScrollingTextRequest? request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        var (message, messageError) = NormaliseMessage(request?.Message);
        if (messageError is not null)
        {
            return Results.BadRequest(new { message = messageError });
        }
        var (url, urlError) = NormaliseUrl(request?.Url);
        if (urlError is not null)
        {
            return Results.BadRequest(new { message = urlError });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
        await using var command = new SqlCommand(
            @"INSERT INTO dbo.scrolling_texts (message, url, sort_order, is_active)
              VALUES (@message, @url, @sortOrder, @isActive);
              SELECT CAST(SCOPE_IDENTITY() AS int);", conn, tx);
        command.Parameters.AddWithValue("message", message!);
        command.Parameters.AddWithValue("url", (object?)url ?? DBNull.Value);
        command.Parameters.AddWithValue("sortOrder", request?.SortOrder ?? 0);
        command.Parameters.AddWithValue("isActive", request?.IsActive ?? true);

        var id = (int)(await command.ExecuteScalarAsync(ct) ?? 0);
        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "scrollingText.create", "scrollingText", id.ToString(), http,
            new { message, url, isActive = request?.IsActive ?? true }, ct);
        await tx.CommitAsync(ct);

        return Results.Created($"/api/v1/admin/scrolling-text/{id}", new { id });
    }

    private static async Task<IResult> UpdateScrollingText(
        int id, ScrollingTextRequest? request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        // Each field is optional on an update, so switching a line off does not mean retyping it.
        string? message = null;
        if (request?.Message is not null)
        {
            var (checkedMessage, messageError) = NormaliseMessage(request.Message);
            if (messageError is not null)
            {
                return Results.BadRequest(new { message = messageError });
            }
            message = checkedMessage;
        }

        /* An empty string clears the link; a missing field leaves it alone. The two have to be told
           apart, because "remove the link" is a thing staff will want and `null` already means
           "unchanged" for every other field here. */
        var clearUrl = request?.Url is not null && request.Url.Trim().Length == 0;
        string? url = null;
        if (request?.Url is not null && !clearUrl)
        {
            var (checkedUrl, urlError) = NormaliseUrl(request.Url);
            if (urlError is not null)
            {
                return Results.BadRequest(new { message = urlError });
            }
            url = checkedUrl;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
        await using var command = new SqlCommand(
            @"UPDATE dbo.scrolling_texts
                 SET message    = COALESCE(@message, message),
                     url        = CASE WHEN @clearUrl = 1 THEN NULL ELSE COALESCE(@url, url) END,
                     sort_order = COALESCE(@sortOrder, sort_order),
                     is_active  = COALESCE(@isActive, is_active),
                     updated_at = SYSDATETIMEOFFSET()
               WHERE id = @id;
              SELECT @@ROWCOUNT;", conn, tx);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("message", (object?)message ?? DBNull.Value);
        command.Parameters.AddWithValue("url", (object?)url ?? DBNull.Value);
        command.Parameters.AddWithValue("clearUrl", clearUrl);
        command.Parameters.AddWithValue("sortOrder", (object?)request?.SortOrder ?? DBNull.Value);
        command.Parameters.AddWithValue("isActive", (object?)request?.IsActive ?? DBNull.Value);

        var changed = (int)(await command.ExecuteScalarAsync(ct) ?? 0);
        if (changed == 0)
        {
            return Results.NotFound(new { message = "No such line." });
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "scrollingText.update", "scrollingText", id.ToString(), http,
            new { message, url, clearUrl, sortOrder = request?.SortOrder, isActive = request?.IsActive }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }

    /// <summary>
    /// Removes a line. Deleting is offered here, unlike for a category or a locality: nothing points
    /// at one of these rows, so there is nothing to orphan. Switching it off is still the gentler
    /// option and the screen offers both.
    /// </summary>
    private static async Task<IResult> DeleteScrollingText(
        int id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
        await using var command = new SqlCommand(
            "DELETE FROM dbo.scrolling_texts WHERE id = @id; SELECT @@ROWCOUNT;", conn, tx);
        command.Parameters.AddWithValue("id", id);

        var changed = (int)(await command.ExecuteScalarAsync(ct) ?? 0);
        if (changed == 0)
        {
            return Results.NotFound(new { message = "No such line." });
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "scrollingText.delete", "scrollingText", id.ToString(), http,
            new { deleted = true }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }
}
