using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Two ways of looking at the platform from above, under /api/v1/super-admin.
///
///   /category-counts — how many listings sit on each category and subcategory. The original's
///                      `Super/ListingsByCategory`. It answers the question the flat listing list
///                      cannot: where is the directory thin? A category with two listings is a
///                      page not worth visiting, and that is invisible when listings are only ever
///                      shown newest-first.
///
///   /accounts        — the people who own listings. The original's `Super/RegisterData`. One row
///                      per user account, with how many listings it holds.
///
/// Both read gated on <c>users.view</c> for accounts and <c>listings.edit</c> for the counts —
/// the permission that already lets a super admin pick a listing to work on. Changing an account's
/// status is a separate matter and takes <c>admins.manage</c>, because suspending a business
/// owner's account takes their listings off the public site with it.
///
/// What is deliberately **not** here: an account's one-time codes, its session tokens or anything
/// that would let staff act as that person. Staff can see who an account is and suspend it. Signing
/// in as somebody is not an administrative convenience, it is an impersonation feature, and it is
/// not built.
/// </summary>
public static class SuperAdminDirectoryEndpoints
{
    private const int DefaultPageSize = 25;
    private const int MaxPageSize = 100;

    /// <summary>One category or subcategory, with what is filed under it.</summary>
    public sealed record CategoryCountDto(
        int Id,
        short Level,
        string Slug,
        string Name,
        string? ParentSlug,
        string? ParentName,
        bool IsActive,
        /// <summary>Listings whose primary category this is, and which are live.</summary>
        int ActiveCount,
        /// <summary>Listings filed here in any status — draft and suspended included.</summary>
        int TotalCount);

    public sealed record AccountRowDto(
        long Id,
        string PhoneE164,
        string? Name,
        string? Email,
        string Status,
        bool PhoneVerified,
        int ListingCount,
        DateTimeOffset CreatedAt);

    public sealed record AccountPageDto(
        IReadOnlyList<AccountRowDto> Items, int Page, int PageSize, int Total, int TotalPages);

    /// <summary>One listing belonging to an account, enough to recognise it and open it.</summary>
    public sealed record AccountListingDto(long Id, string Name, string Slug, string Status, string LocalityName);

    public sealed record AccountDetailDto(AccountRowDto Account, IReadOnlyList<AccountListingDto> Listings);

    public sealed record AccountStatusRequest(string? Status);

    /// <summary>The statuses `users_status_check` allows. "deleted" is not offered: see SetStatus.</summary>
    private static readonly string[] SettableStatuses = ["active", "suspended"];

    public static RouteGroupBuilder MapSuperAdminDirectoryEndpoints(this RouteGroupBuilder super)
    {
        super.MapGet("/category-counts", GetCategoryCounts);

        var accounts = super.MapGroup("/accounts");
        accounts.MapGet("", ListAccounts);
        accounts.MapGet("/{id:long}", GetAccount);
        accounts.MapPut("/{id:long}/status", SetAccountStatus);

        return super;
    }

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

    // ---- listings by category ------------------------------------------------------------------

    /// <summary>
    /// Every category and subcategory with its listing counts, in directory order.
    ///
    /// One query for the whole tree rather than one per level. The front end groups it, which means
    /// the by-category and by-subcategory screens are the same data read two ways and cannot
    /// disagree about a total.
    ///
    /// Only the *primary* category is counted. A listing can appear under several, but counting
    /// every association would make the totals add up to more than the number of listings, and the
    /// question this screen answers — "how many businesses would someone find on this page?" — is
    /// about the primary one.
    /// </summary>
    private static async Task<IResult> GetCategoryCounts(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, AdminPermissions.ListingsEdit, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var command = db.CreateCommand(
            @"SELECT c.id, c.level, c.slug, c.name,
                     parent.slug AS parent_slug, parent.name AS parent_name, c.is_active,
                     COALESCE(counts.active_count, 0) AS active_count,
                     COALESCE(counts.total_count, 0) AS total_count
              FROM dbo.categories c
              LEFT JOIN dbo.categories parent ON parent.id = c.parent_id
              /* Aggregated once in a derived table and joined, rather than two correlated
                 subqueries per row. With a few hundred categories either works; this one reads the
                 listing tables once. */
              LEFT JOIN (
                  SELECT lc.category_id,
                         SUM(CASE WHEN li.status = 'active' THEN 1 ELSE 0 END) AS active_count,
                         COUNT(*) AS total_count
                  FROM dbo.listing_categories lc
                  JOIN dbo.listings li ON li.id = lc.listing_id
                  WHERE lc.is_primary = 1
                  GROUP BY lc.category_id
              ) counts ON counts.category_id = c.id
              ORDER BY c.level, parent.sort_order, parent.name, c.sort_order, c.name");

        var items = new List<CategoryCountDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new CategoryCountDto(
                reader.GetInt32(0),
                reader.GetInt16(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetBoolean(6),
                reader.GetInt32(7),
                reader.GetInt32(8)));
        }

        return Results.Ok(items);
    }

    // ---- business accounts ---------------------------------------------------------------------

    private static AccountRowDto ReadAccount(SqlDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.IsDBNull(2) ? null : reader.GetString(2),
        reader.IsDBNull(3) ? null : reader.GetString(3),
        reader.GetString(4),
        !reader.IsDBNull(5),
        reader.GetInt32(6),
        reader.GetFieldValue<DateTimeOffset>(7));

    /// <summary>
    /// Accounts that own at least one listing, newest first, optionally narrowed by name, phone,
    /// email or status.
    ///
    /// Only accounts with a listing. A phone number that requested a login code once and never
    /// finished has a `users` row, and listing those would turn this screen into a log of
    /// half-finished sign-ins rather than a list of the businesses on the platform.
    /// </summary>
    private static async Task<IResult> ListAccounts(
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct,
        string? q = null,
        string? status = null,
        int? page = null,
        int? pageSize = null)
    {
        var (_, refused) = await Gate(principal, db, AdminPermissions.UsersView, ct);
        if (refused is not null)
        {
            return refused;
        }

        var currentPage = page is > 0 ? page.Value : 1;
        var size = pageSize is > 0 ? Math.Min(pageSize.Value, MaxPageSize) : DefaultPageSize;
        var search = string.IsNullOrWhiteSpace(q) ? null : q.Trim();

        // The page and the total in one statement, so the two cannot disagree — the same shape the
        // moderation queue and the super-admin listing list use.
        await using var command = db.CreateCommand(
            @"WITH owners AS (
                SELECT u.id, u.phone_e164, u.name, u.email, u.status, u.phone_verified_at,
                       u.created_at,
                       (SELECT COUNT(*)
                        FROM dbo.business_members bm
                        JOIN dbo.listings li ON li.business_id = bm.business_id
                        WHERE bm.user_id = u.id) AS listing_count
                FROM dbo.users u
                WHERE EXISTS (
                    SELECT 1 FROM dbo.business_members bm
                    JOIN dbo.listings li ON li.business_id = bm.business_id
                    WHERE bm.user_id = u.id
                )
              ),
              matched AS (
                SELECT *, COUNT_BIG(*) OVER () AS total
                FROM owners
                WHERE (@status IS NULL OR status = @status)
                  AND (@q IS NULL
                       OR name LIKE '%' + @q + '%'
                       OR email LIKE '%' + @q + '%'
                       OR phone_e164 LIKE '%' + @q + '%')
              )
              SELECT id, phone_e164, name, email, status, phone_verified_at, listing_count,
                     created_at, total
              FROM matched
              ORDER BY created_at DESC
              OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY");
        command.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar) { Value = (object?)status ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("q", SqlDbType.NVarChar) { Value = (object?)search ?? DBNull.Value });
        command.Parameters.AddWithValue("skip", (currentPage - 1) * size);
        command.Parameters.AddWithValue("take", size);

        var items = new List<AccountRowDto>();
        var total = 0L;
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                items.Add(ReadAccount(reader));
                total = reader.GetInt64(8);
            }
        }

        var totalPages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)size);
        return Results.Ok(new AccountPageDto(items, currentPage, size, (int)total, totalPages));
    }

    private static async Task<IResult> GetAccount(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (_, refused) = await Gate(principal, db, AdminPermissions.UsersView, ct);
        if (refused is not null)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);

        AccountRowDto? account = null;
        await using (var command = new SqlCommand(
            @"SELECT u.id, u.phone_e164, u.name, u.email, u.status, u.phone_verified_at,
                     (SELECT COUNT(*)
                      FROM dbo.business_members bm
                      JOIN dbo.listings li ON li.business_id = bm.business_id
                      WHERE bm.user_id = u.id) AS listing_count,
                     u.created_at
              FROM dbo.users u
              WHERE u.id = @id", conn))
        {
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                account = ReadAccount(reader);
            }
        }

        if (account is null)
        {
            return Results.NotFound();
        }

        var listings = new List<AccountListingDto>();
        await using (var command = new SqlCommand(
            @"SELECT li.id, li.name, li.slug, li.status, lo.name
              FROM dbo.business_members bm
              JOIN dbo.listings li ON li.business_id = bm.business_id
              JOIN dbo.localities lo ON lo.id = li.locality_id
              WHERE bm.user_id = @id
              ORDER BY li.created_at DESC", conn))
        {
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                listings.Add(new AccountListingDto(
                    reader.GetInt64(0), reader.GetString(1), reader.GetString(2),
                    reader.GetString(3), reader.GetString(4)));
            }
        }

        return Results.Ok(new AccountDetailDto(account, listings));
    }

    /// <summary>
    /// Suspends or reinstates an account.
    ///
    /// Only 'active' and 'suspended' are accepted, although `users_status_check` also allows
    /// 'deleted'. Deleting is not offered here on purpose: `business_members` and everything hanging
    /// off a listing would have to be dealt with, and a suspended account already stops the person
    /// signing in. An endpoint that marks an account deleted while its listings stay live is worse
    /// than no endpoint.
    ///
    /// Gated on admins.manage rather than users.view: this takes someone's listings off the public
    /// site, so it is not a reading permission.
    /// </summary>
    private static async Task<IResult> SetAccountStatus(
        long id,
        AccountStatusRequest? request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refused) = await Gate(principal, db, AdminPermissions.AdminsManage, ct);
        if (refused is not null)
        {
            return refused;
        }

        var status = request?.Status?.Trim().ToLowerInvariant();
        if (status is null || !SettableStatuses.Contains(status))
        {
            return Results.BadRequest(new
            {
                message = $"Status must be one of: {string.Join(", ", SettableStatuses)}.",
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        await using var command = new SqlCommand(
            @"UPDATE dbo.users
                 SET status = @status, updated_at = SYSDATETIMEOFFSET()
               -- Not a deleted account: reinstating one of those is a different decision, and this
               -- endpoint should not be the way it happens by accident.
               WHERE id = @id AND status <> 'deleted';
              SELECT @@ROWCOUNT;", conn, tx);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar) { Value = status });

        var changed = (int)(await command.ExecuteScalarAsync(ct) ?? 0);
        if (changed == 0)
        {
            return Results.NotFound(new { message = "No such account, or it has been deleted." });
        }

        await AuditLog.WriteAsync(
            conn, tx, admin!.Id, "account.status", "user", id.ToString(), http, new { status }, ct);
        await tx.CommitAsync(ct);

        return Results.NoContent();
    }
}
