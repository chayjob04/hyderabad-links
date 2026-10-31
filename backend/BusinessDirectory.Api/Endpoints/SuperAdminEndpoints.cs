using BusinessDirectory.Api.Data;
using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Platform administration, under /api/v1/super-admin.
///
/// Two gates, not one. The route group is pinned to <see cref="AdminAccess.SuperPolicy"/>, which
/// accepts only the super-admin audience, so an ordinary administrator's token is refused before a
/// handler runs. Every handler then checks a permission reserved for this surface, read live from
/// the database, so removing the role takes effect on the next request.
///
/// What is deliberately absent: creating an admin account and resetting someone's password. Both
/// need a way to reach the person out of band, and no email provider is configured yet (see
/// docs/PROJECT_STATUS.md). <c>create-admin</c> on the command line remains the only way to make an
/// account, which is the honest position rather than inventing a password-handling path here.
/// </summary>
public static class SuperAdminEndpoints
{
    public sealed record SuperAdminProfileDto(long Id, string Email, string DisplayName, IReadOnlyList<string> Roles, IReadOnlyList<string> Permissions);

    /// <param name="MfaEnrolled">False until the account has set up an authenticator. It cannot sign in without one.</param>
    public sealed record AdminAccountDto(
        long Id,
        string Email,
        string DisplayName,
        string Status,
        IReadOnlyList<string> Roles,
        bool MfaEnrolled,
        int UnusedRecoveryCodes,
        DateTimeOffset? LastSignInAt,
        DateTimeOffset CreatedAt);

    public sealed record RoleDto(string Slug, string Name, IReadOnlyList<string> Permissions);

    /// <summary>Platform figures, every one counted from real rows. Nothing here is an estimate.</summary>
    public sealed record OverviewDto(
        IReadOnlyList<CountDto> ListingsByStatus,
        IReadOnlyList<CountDto> ListingsByPlan,
        int Businesses,
        int Owners,
        int AdminAccounts,
        int PendingReviews,
        int OpenReports,
        int NewEnquiries);

    public sealed record CountDto(string Key, int Count);

    public sealed record AuditEntryDto(
        long Id,
        DateTimeOffset OccurredAt,
        string ActorType,
        /// <summary>The admin's display name where the actor was an admin; null for anyone else.</summary>
        string? ActorName,
        string Action,
        string? EntityType,
        string? EntityId,
        string? Details);

    public sealed record AuditPage(IReadOnlyList<AuditEntryDto> Items, int Page, int PageSize, int Total, int TotalPages);

    public sealed record RolesRequest(string[]? Roles);

    public sealed record StatusRequest(string? Status);

    private const int AuditPageSize = 50;

    public static RouteGroupBuilder MapSuperAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/super-admin").RequireAuthorization(AdminAccess.SuperPolicy);
        group.MapGet("/me", GetMe);
        group.MapGet("/overview", GetOverview);
        group.MapGet("/admins", ListAdmins);
        group.MapGet("/roles", ListRoles);
        group.MapPut("/admins/{id:long}/roles", SetRoles);
        group.MapPut("/admins/{id:long}/status", SetStatus);
        group.MapPost("/admins/{id:long}/reset-mfa", ResetMfa);
        group.MapGet("/audit", GetAudit);
        group.MapSuperAdminListingEndpoints();   // add, correct, archive and delete listings
        group.MapSuperAdminHomepageGroupEndpoints();  // named shelves for the homepage
        return group;
    }

    /// <summary>
    /// Reads one of the comma-separated lists the queries build. Null means none, which is an empty
    /// list rather than a missing one.
    /// </summary>
    private static string[] SplitList(Microsoft.Data.SqlClient.SqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? [] : reader.GetString(ordinal).Split(',', StringSplitOptions.RemoveEmptyEntries);

    /// <summary>Loads the caller and checks one super-admin permission, or returns the refusal to send back.</summary>
    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, string permission, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return (null, Results.Unauthorized());
        }
        return AdminAccess.AuthorizeSuper(admin, permission) is { } refusal ? (null, refusal) : (admin, null);
    }

    private static async Task<IResult> GetMe(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, AdminPermissions.AdminsManage, ct);
        if (admin is null)
        {
            return refusal!;
        }

        return Results.Ok(new SuperAdminProfileDto(admin.Id, admin.Email, admin.DisplayName, admin.Roles, admin.Permissions));
    }

    // ------------------------------------------------------------------ overview
    private static async Task<IResult> GetOverview(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, AdminPermissions.AnalyticsView, ct);
        if (admin is null)
        {
            return refusal!;
        }

        // One round trip. Every figure is a count of rows that exist; there is deliberately no
        // "views", "visits" or "revenue" here, because nothing in the database records any of them.
        await using var command = db.CreateCommand(
            @"SELECT
                (SELECT COUNT_BIG(*) FROM businesses),
                (SELECT COUNT_BIG(*) FROM users),
                (SELECT COUNT_BIG(*) FROM admin_users WHERE status = 'active'),
                (SELECT COUNT_BIG(*) FROM reviews WHERE status = 'pending'),
                (SELECT COUNT_BIG(*) FROM reports WHERE status = 'open'),
                (SELECT COUNT_BIG(*) FROM enquiries WHERE status = 'new')");
        await using var reader = await command.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);
        var businesses = (int)reader.GetInt64(0);
        var owners = (int)reader.GetInt64(1);
        var admins = (int)reader.GetInt64(2);
        var pendingReviews = (int)reader.GetInt64(3);
        var openReports = (int)reader.GetInt64(4);
        var newEnquiries = (int)reader.GetInt64(5);
        await reader.CloseAsync();

        var byStatus = await CountRows(db, "SELECT status, COUNT_BIG(*) FROM listings GROUP BY status ORDER BY status", ct);
        var byPlan = await CountRows(
            db,
            /* Grouped by the *effective* plan, from listing_entitlements, not by listings.plan_slug.
               That column records what a listing bought and never expires, so counting it would
               report a listing as Verified years after its period ran out — the one figure on this
               page staff would use to answer "how many are paying right now". */
            @"SELECT p.slug, COUNT_BIG(e.listing_id)
              FROM dbo.plans p
              LEFT JOIN dbo.listing_entitlements e ON e.effective_plan_slug = p.slug
              GROUP BY p.slug, p.sort_order
              ORDER BY p.sort_order",
            ct);

        return Results.Ok(new OverviewDto(
            byStatus, byPlan, businesses, owners, admins, pendingReviews, openReports, newEnquiries));
    }

    private static async Task<List<CountDto>> CountRows(SqlDatabase db, string sql, CancellationToken ct)
    {
        await using var command = db.CreateCommand(sql);
        await using var reader = await command.ExecuteReaderAsync(ct);
        var rows = new List<CountDto>();
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new CountDto(reader.GetString(0), (int)reader.GetInt64(1)));
        }
        return rows;
    }

    // ------------------------------------------------------------------ admin accounts
    private static async Task<IResult> ListAdmins(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, AdminPermissions.AdminsManage, ct);
        if (admin is null)
        {
            return refusal!;
        }

        await using var command = db.CreateCommand(
            /* The roles come back as one comma-separated string, as in AdminAccess: SQL Server has
               no array type and STRING_AGG has neither DISTINCT nor FILTER. With the aggregate inside
               a subquery there is nothing left to GROUP BY either. */
            @"SELECT au.id, au.email, au.display_name, au.status,
                     (SELECT STRING_AGG(x.slug, ',')
                      FROM (SELECT DISTINCT r.slug
                            FROM admin_user_roles aur
                            JOIN roles r ON r.id = aur.role_id
                            WHERE aur.admin_user_id = au.id) x),
                     CAST(CASE WHEN au.totp_enabled_at IS NOT NULL THEN 1 ELSE 0 END AS bit),
                     (SELECT COUNT_BIG(*) FROM admin_recovery_codes arc
                      WHERE arc.admin_user_id = au.id AND arc.used_at IS NULL),
                     (SELECT max(s.created_at) FROM admin_sessions s WHERE s.admin_user_id = au.id),
                     au.created_at
              FROM admin_users au
              ORDER BY au.created_at");

        await using var reader = await command.ExecuteReaderAsync(ct);
        var accounts = new List<AdminAccountDto>();
        while (await reader.ReadAsync(ct))
        {
            accounts.Add(new AdminAccountDto(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                SplitList(reader, 4),
                reader.GetBoolean(5),
                (int)reader.GetInt64(6),
                reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
                reader.GetFieldValue<DateTimeOffset>(8)));
        }
        return Results.Ok(accounts);
    }

    private static async Task<IResult> ListRoles(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, AdminPermissions.AdminsManage, ct);
        if (admin is null)
        {
            return refusal!;
        }

        await using var command = db.CreateCommand(
            @"SELECT r.slug, r.name,
                     (SELECT STRING_AGG(p.code, ',') WITHIN GROUP (ORDER BY p.code)
                      FROM role_permissions rp
                      JOIN permissions p ON p.id = rp.permission_id
                      WHERE rp.role_id = r.id)
              FROM roles r
              ORDER BY r.name");

        await using var reader = await command.ExecuteReaderAsync(ct);
        var roles = new List<RoleDto>();
        while (await reader.ReadAsync(ct))
        {
            roles.Add(new RoleDto(reader.GetString(0), reader.GetString(1), SplitList(reader, 2)));
        }
        return Results.Ok(roles);
    }

    /// <summary>
    /// Replaces an account's roles with the set given. Roles are named by slug, and an unknown slug is
    /// refused rather than quietly dropped, so a typo cannot silently leave someone with no role.
    /// </summary>
    private static async Task<IResult> SetRoles(
        long id,
        RolesRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, AdminPermissions.AdminsManage, ct);
        if (admin is null)
        {
            return refusal!;
        }

        var wanted = (request.Roles ?? [])
            .Select(role => role?.Trim().ToLowerInvariant())
            .Where(role => !string.IsNullOrEmpty(role))
            .Distinct()
            .ToArray();

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var find = new SqlCommand("SELECT id FROM admin_users WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE id = @id", conn, tx))
        {
            find.Parameters.AddWithValue("id", id);
            if (await find.ExecuteScalarAsync(ct) is null)
            {
                return Results.NotFound();
            }
        }

        // Taking the last super admin's own power away would leave nobody able to put it back, so it
        // is refused. Checked inside the transaction, against the rows as they are about to be.
        if (id == admin.Id && !wanted.Contains("super_admin"))
        {
            await using var others = new SqlCommand(
                @"SELECT COUNT_BIG(*)
                  FROM admin_user_roles aur
                  JOIN roles r ON r.id = aur.role_id
                  JOIN admin_users au ON au.id = aur.admin_user_id
                  WHERE r.slug = 'super_admin' AND au.status = 'active' AND au.id <> @id", conn, tx);
            others.Parameters.AddWithValue("id", id);
            if ((long)(await others.ExecuteScalarAsync(ct))! == 0)
            {
                return Results.Problem(
                    "You are the only active super admin. Give someone else the role first.",
                    statusCode: StatusCodes.Status409Conflict);
            }
        }

        long[] roleIds;
        /* PostgreSQL could take an array parameter and say "slug = ANY(@slugs)". SQL Server has no
           array type: the slugs travel as one comma-separated string and STRING_SPLIT makes rows of
           them again. A role slug cannot contain a comma -- the slug format check in S0003 allows
           only letters, digits and underscores -- so nothing can be split in the wrong place. */
        await using (var lookup = new SqlCommand(
            "SELECT r.slug, r.id FROM roles r JOIN STRING_SPLIT(@slugs, ',') s ON s.value = r.slug", conn, tx))
        {
            lookup.Parameters.Add(new SqlParameter("slugs", SqlDbType.NVarChar) { Value = string.Join(",", wanted) });
            await using var reader = await lookup.ExecuteReaderAsync(ct);
            var found = new Dictionary<string, long>();
            while (await reader.ReadAsync(ct))
            {
                // roles.id is an int. Npgsql widened one to long on request; SqlClient does not.
                found[reader.GetString(0)] = reader.GetInt32(1);
            }

            var unknown = wanted.Where(slug => !found.ContainsKey(slug!)).ToArray();
            if (unknown.Length > 0)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["roles"] = [$"Unknown role: {string.Join(", ", unknown)}."],
                });
            }
            roleIds = [.. found.Values];
        }

        await using (var clear = new SqlCommand("DELETE FROM admin_user_roles WHERE admin_user_id = @id", conn, tx))
        {
            clear.Parameters.AddWithValue("id", id);
            await clear.ExecuteNonQueryAsync(ct);
        }

        if (roleIds.Length > 0)
        {
            await using var insert = new SqlCommand(
                @"INSERT INTO admin_user_roles (admin_user_id, role_id)
                  SELECT @id, CAST(value AS int) FROM STRING_SPLIT(@roles, ',')", conn, tx);
            insert.Parameters.AddWithValue("id", id);
            insert.Parameters.Add(new SqlParameter("roles", SqlDbType.NVarChar)
            {
                Value = string.Join(",", roleIds),
            });
            await insert.ExecuteNonQueryAsync(ct);
        }

        await WriteAudit(conn, tx, admin.Id, "admin.roles_changed", id, http, new { roles = wanted }, ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    /// <summary>
    /// Disables an account or puts it back. A disabled account cannot sign in and cannot be loaded
    /// from a token it already holds, because <see cref="AdminAccess.Load"/> requires
    /// <c>status = 'active'</c> — so suspending takes effect on that account's very next request.
    /// </summary>
    private static async Task<IResult> SetStatus(
        long id,
        StatusRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, AdminPermissions.AdminsManage, ct);
        if (admin is null)
        {
            return refusal!;
        }

        // "disabled" is the word the schema uses (admin_users_status_check), so it is the word used
        // here: inventing a synonym would mean a status the database refuses.
        var status = request.Status?.Trim().ToLowerInvariant();
        if (status is not ("active" or "disabled"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["status"] = ["Send active or disabled."],
            });
        }

        if (id == admin.Id && status == "disabled")
        {
            // Locking yourself out is never what was meant, and nobody else can undo it for you.
            return Results.Problem("You cannot disable your own account.", statusCode: StatusCodes.Status409Conflict);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var update = new SqlCommand(
            "UPDATE admin_users SET status = @status, updated_at = SYSDATETIMEOFFSET() OUTPUT inserted.id WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("status", status);
            update.Parameters.AddWithValue("id", id);
            if (await update.ExecuteScalarAsync(ct) is null)
            {
                return Results.NotFound();
            }
        }

        if (status == "disabled")
        {
            // End the sessions too, so a token already issued stops being refreshable.
            await using var revoke = new SqlCommand(
                "UPDATE admin_sessions SET revoked_at = SYSDATETIMEOFFSET() WHERE admin_user_id = @id AND revoked_at IS NULL", conn, tx);
            revoke.Parameters.AddWithValue("id", id);
            await revoke.ExecuteNonQueryAsync(ct);
        }

        await WriteAudit(conn, tx, admin.Id, status == "active" ? "admin.reactivated" : "admin.disabled", id, http, new { status }, ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    /// <summary>
    /// Clears an authenticator enrollment so the person can set a new one up.
    ///
    /// This is safe because it removes an authenticator rather than granting a way in: the account
    /// still needs its password, and the next sign-in walks the enrollment screens again. It does not
    /// reset a password, which would need a way to reach the person that does not exist yet.
    /// </summary>
    private static async Task<IResult> ResetMfa(
        long id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, AdminPermissions.AdminsManage, ct);
        if (admin is null)
        {
            return refusal!;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var update = new SqlCommand(
            @"UPDATE admin_users
              SET totp_secret_encrypted = NULL, totp_enabled_at = NULL, totp_last_step = NULL, updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.id
              WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            if (await update.ExecuteScalarAsync(ct) is null)
            {
                return Results.NotFound();
            }
        }

        // The old recovery codes belonged to the old authenticator, and any live session was opened
        // with it, so both go.
        await using (var codes = new SqlCommand("DELETE FROM admin_recovery_codes WHERE admin_user_id = @id", conn, tx))
        {
            codes.Parameters.AddWithValue("id", id);
            await codes.ExecuteNonQueryAsync(ct);
        }
        await using (var revoke = new SqlCommand(
            "UPDATE admin_sessions SET revoked_at = SYSDATETIMEOFFSET() WHERE admin_user_id = @id AND revoked_at IS NULL", conn, tx))
        {
            revoke.Parameters.AddWithValue("id", id);
            await revoke.ExecuteNonQueryAsync(ct);
        }

        await WriteAudit(conn, tx, admin.Id, "admin.mfa_reset", id, http, new { }, ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    // ------------------------------------------------------------------ audit log
    private static async Task<IResult> GetAudit(
        string? action,
        string? entityType,
        int? page,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, AdminPermissions.AuditView, ct);
        if (admin is null)
        {
            return refusal!;
        }

        var currentPage = Math.Max(page ?? 1, 1);

        await using var command = db.CreateCommand(
            @"WITH matching AS (
                  SELECT a.id, a.occurred_at, a.actor_type, a.actor_id, a.action, a.entity_type,
                         a.entity_id, a.details, au.display_name AS actor_name
                  FROM audit_logs a
                  LEFT JOIN admin_users au ON a.actor_type = 'admin' AND au.id = a.actor_id
                  WHERE (@action IS NULL OR a.action = @action)
                    AND (@entity IS NULL OR a.entity_type = @entity)
              ),
              page AS (
                  SELECT * FROM matching ORDER BY occurred_at DESC, id DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY
              )
              SELECT (SELECT COUNT_BIG(*) FROM matching),
                     p.id, p.occurred_at, p.actor_type, p.actor_name, p.action, p.entity_type,
                     p.entity_id, p.details
              FROM (SELECT 1 AS one) AS always_one_row
              LEFT JOIN page p ON 1 = 1
              ORDER BY p.occurred_at DESC, p.id DESC");
        command.Parameters.Add(new SqlParameter("action", SqlDbType.NVarChar) { Value = (object?)action?.Trim() ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("entity", SqlDbType.NVarChar) { Value = (object?)entityType?.Trim() ?? DBNull.Value });
        command.Parameters.AddWithValue("size", AuditPageSize);
        command.Parameters.AddWithValue("offset", (currentPage - 1) * AuditPageSize);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var items = new List<AuditEntryDto>();
        var total = 0;
        while (await reader.ReadAsync(ct))
        {
            total = (int)reader.GetInt64(0);
            if (reader.IsDBNull(1))
            {
                continue;   // the placeholder row: this page holds no entries
            }

            items.Add(new AuditEntryDto(
                reader.GetInt64(1),
                reader.GetFieldValue<DateTimeOffset>(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.IsDBNull(8) ? null : reader.GetString(8)));
        }

        var totalPages = (int)Math.Ceiling(total / (double)AuditPageSize);
        return Results.Ok(new AuditPage(items, currentPage, AuditPageSize, total, totalPages));
    }

    // ------------------------------------------------------------------ helpers
    /// <summary>Writes to the append-only audit log in the same transaction as the change itself.</summary>
    private static async Task WriteAudit(
        SqlConnection conn,
        SqlTransaction tx,
        long actorId,
        string action,
        long subjectId,
        HttpContext http,
        object details,
        CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, details, ip)
              VALUES ('admin', @actor, @action, 'admin_user', @entity, @details, @ip)", conn, tx);
        command.Parameters.AddWithValue("actor", actorId);
        command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("entity", subjectId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("details", System.Text.Json.JsonSerializer.Serialize(details));
        command.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar)
        {
            Value = (object?)http.Connection.RemoteIpAddress?.ToString() ?? DBNull.Value,
        });
        await command.ExecuteNonQueryAsync(ct);
    }
}
