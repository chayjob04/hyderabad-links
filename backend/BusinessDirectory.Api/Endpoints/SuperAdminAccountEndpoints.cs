using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Notifications;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Managing administrator accounts, under <c>/api/v1/super-admin/admins</c>. Every route here is on
/// the super-admin policy and additionally requires <c>admins.manage</c>, read live from the
/// database on each request.
///
/// <para>
/// This is the half of the Admin Accounts screen that <see cref="SuperAdminEndpoints"/> did not
/// already cover: creating an account, editing it, resetting its password and ending its sessions.
/// Roles, status and reset-MFA stay where they were, because nothing about them changed.
/// </para>
/// <para>
/// <b>No delete.</b> S0003 said it plainly and the schema is built around it: an account is
/// disabled, never removed, so the audit log and the moderation attribution hanging off it survive.
/// Deleting one means first destroying the record of which listings it approved, which is not a
/// side effect any screen should have.
/// </para>
/// <para>
/// <b>Passwords.</b> A password is hashed by <see cref="AdminPasswords"/> (PBKDF2-HMAC-SHA256,
/// 210,000 iterations) the moment it arrives and is never stored, logged or returned. A temporary
/// one set here is echoed back exactly once, in the response to the request that set it, so the
/// super admin can pass it on; it is never written to the audit log and never readable again.
/// </para>
/// </summary>
public static class SuperAdminAccountEndpoints
{
    public sealed record AdminSummaryDto(int Total, int Active, int SuperAdmins, int Disabled);

    public sealed record AdminRowDto(
        long Id,
        string Email,
        string DisplayName,
        string Status,
        IReadOnlyList<string> Roles,
        bool MfaEnrolled,
        int UnusedRecoveryCodes,
        bool MustChangePassword,
        bool Locked,
        DateTimeOffset? LastLoginAt,
        DateTimeOffset? PasswordChangedAt,
        DateTimeOffset CreatedAt);

    public sealed record AdminPage(IReadOnlyList<AdminRowDto> Items, int Page, int PageSize, int Total, int TotalPages);

    /// <param name="ActiveSessions">Sessions that could still be refreshed right now.</param>
    public sealed record AdminDetailDto(
        AdminRowDto Account,
        int ActiveSessions,
        DateTimeOffset? LockedUntil,
        int FailedLoginCount,
        string? InvitedByName,
        IReadOnlyList<SessionDto> RecentSessions);

    public sealed record SessionDto(DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, bool Revoked, string? Ip);

    public sealed record CreateAdminRequest(string? Email, string? DisplayName, string? Password, string? ConfirmPassword, string? Role);

    public sealed record EditAdminRequest(string? Email, string? DisplayName);

    public sealed record ResetPasswordRequest(string? Password, string? ConfirmPassword);

    /// <param name="TemporaryPassword">Echoed once so it can be handed over. Never stored or logged.</param>
    public sealed record PasswordSetDto(long Id, string TemporaryPassword);

    private const int PageSize = 20;

    public static RouteGroupBuilder MapSuperAdminAccountEndpoints(this RouteGroupBuilder group)
    {
        var admins = group.MapGroup("/admins");
        admins.MapGet("/summary", GetSummary);
        admins.MapGet("/page", ListPage);
        admins.MapGet("/{id:long}", GetDetail);
        admins.MapPost("", Create);
        admins.MapPut("/{id:long}", Edit);
        admins.MapPost("/{id:long}/password", ResetPassword);
        admins.MapPost("/{id:long}/revoke-sessions", RevokeSessions);
        return group;
    }

    // ------------------------------------------------------------------ summary cards
    private static async Task<IResult> GetSummary(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, ct);
        if (admin is null) return refusal!;

        await using var command = db.CreateCommand(
            /* Super admins are counted by the permission, not by the role slug: a role could be
               renamed or a second one could be given admins.manage, and the count would quietly
               stop meaning what it says. */
            @"SELECT
                (SELECT COUNT(*) FROM dbo.admin_users),
                (SELECT COUNT(*) FROM dbo.admin_users WHERE status = 'active'),
                (SELECT COUNT(*) FROM dbo.admin_users au
                 WHERE EXISTS (SELECT 1 FROM dbo.admin_user_roles aur
                               JOIN dbo.role_permissions rp ON rp.role_id = aur.role_id
                               JOIN dbo.permissions p ON p.id = rp.permission_id
                               WHERE aur.admin_user_id = au.id AND p.code = @manage)),
                (SELECT COUNT(*) FROM dbo.admin_users WHERE status = 'disabled')");
        command.Parameters.AddWithValue("manage", AdminPermissions.AdminsManage);

        await using var reader = await command.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);
        return Results.Ok(new AdminSummaryDto(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3)));
    }

    // ------------------------------------------------------------------ the table
    private static async Task<IResult> ListPage(
        string? search,
        string? role,
        string? status,
        string? sort,
        int? page,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, ct);
        if (admin is null) return refusal!;

        var wantedStatus = status?.Trim().ToLowerInvariant();
        if (wantedStatus is not (null or "" or "all" or "invited" or "active" or "disabled"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["Unknown status filter."] });
        }

        /* The sort column is chosen from a fixed list and never interpolated from the caller's
           string. ORDER BY cannot be parameterised, so this is the only safe way to offer it. */
        var order = (sort?.Trim().ToLowerInvariant()) switch
        {
            "name" => "au.display_name ASC",
            "email" => "au.email ASC",
            "status" => "au.status ASC, au.display_name ASC",
            "last_login" => "au.last_login_at DESC",
            "oldest" => "au.created_at ASC",
            _ => "au.created_at DESC",
        };

        var currentPage = Math.Max(page ?? 1, 1);

        await using var command = db.CreateCommand(
            $@"WITH matching AS (
                   SELECT au.id
                   FROM dbo.admin_users au
                   WHERE (@search IS NULL
                          OR au.display_name LIKE '%' + @search + '%'
                          OR au.email LIKE '%' + @search + '%')
                     AND (@status IS NULL OR au.status = @status)
                     AND (@role IS NULL OR EXISTS (SELECT 1 FROM dbo.admin_user_roles aur
                                                   JOIN dbo.roles r ON r.id = aur.role_id
                                                   WHERE aur.admin_user_id = au.id AND r.slug = @role))
               )
               SELECT (SELECT COUNT(*) FROM matching) AS total,
                      au.id, au.email, au.display_name, au.status,
                      (SELECT STRING_AGG(x.slug, ',')
                       FROM (SELECT DISTINCT r.slug FROM dbo.admin_user_roles aur
                             JOIN dbo.roles r ON r.id = aur.role_id
                             WHERE aur.admin_user_id = au.id) x),
                      CAST(CASE WHEN au.totp_enabled_at IS NOT NULL THEN 1 ELSE 0 END AS bit),
                      (SELECT COUNT(*) FROM dbo.admin_recovery_codes arc
                       WHERE arc.admin_user_id = au.id AND arc.used_at IS NULL),
                      au.must_change_password,
                      CAST(CASE WHEN au.locked_until > SYSDATETIMEOFFSET() THEN 1 ELSE 0 END AS bit),
                      au.last_login_at, au.password_changed_at, au.created_at
               FROM dbo.admin_users au
               JOIN matching m ON m.id = au.id
               ORDER BY {order}
               OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY");
        var trimmed = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        command.Parameters.Add(new SqlParameter("search", SqlDbType.NVarChar, 200) { Value = (object?)trimmed ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar, 20)
        {
            Value = wantedStatus is null or "" or "all" ? DBNull.Value : wantedStatus,
        });
        command.Parameters.Add(new SqlParameter("role", SqlDbType.VarChar, 50)
        {
            Value = string.IsNullOrWhiteSpace(role) || role == "all" ? DBNull.Value : role.Trim(),
        });
        command.Parameters.AddWithValue("offset", (currentPage - 1) * PageSize);
        command.Parameters.AddWithValue("size", PageSize);

        var items = new List<AdminRowDto>();
        var total = 0;
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                total = reader.GetInt32(0);
                items.Add(ReadRow(reader, 1));
            }
        }

        // The count query runs inside the row query, so an empty page has to ask for it separately.
        if (items.Count == 0)
        {
            total = await CountMatching(db, trimmed, wantedStatus, role, ct);
        }

        var totalPages = total == 0 ? 1 : (int)Math.Ceiling(total / (double)PageSize);
        return Results.Ok(new AdminPage(items, currentPage, PageSize, total, totalPages));
    }

    // ------------------------------------------------------------------ one account
    private static async Task<IResult> GetDetail(long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, ct);
        if (admin is null) return refusal!;

        AdminRowDto row;
        DateTimeOffset? lockedUntil;
        int failedLogins;
        string? invitedBy;
        await using (var command = db.CreateCommand(
            @"SELECT au.id, au.email, au.display_name, au.status,
                     (SELECT STRING_AGG(x.slug, ',')
                      FROM (SELECT DISTINCT r.slug FROM dbo.admin_user_roles aur
                            JOIN dbo.roles r ON r.id = aur.role_id
                            WHERE aur.admin_user_id = au.id) x),
                     CAST(CASE WHEN au.totp_enabled_at IS NOT NULL THEN 1 ELSE 0 END AS bit),
                     (SELECT COUNT(*) FROM dbo.admin_recovery_codes arc
                      WHERE arc.admin_user_id = au.id AND arc.used_at IS NULL),
                     au.must_change_password,
                     CAST(CASE WHEN au.locked_until > SYSDATETIMEOFFSET() THEN 1 ELSE 0 END AS bit),
                     au.last_login_at, au.password_changed_at, au.created_at,
                     au.locked_until, au.failed_login_count,
                     (SELECT inv.display_name FROM dbo.admin_users inv WHERE inv.id = au.invited_by_admin_id)
              FROM dbo.admin_users au WHERE au.id = @id"))
        {
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound();
            row = ReadRow(reader, 0);
            lockedUntil = reader.IsDBNull(12) ? null : reader.GetFieldValue<DateTimeOffset>(12);
            failedLogins = reader.GetInt32(13);
            invitedBy = reader.IsDBNull(14) ? null : reader.GetString(14);
        }

        var sessions = new List<SessionDto>();
        var active = 0;
        await using (var command = db.CreateCommand(
            @"SELECT TOP (10) s.created_at, s.expires_at,
                     CAST(CASE WHEN s.revoked_at IS NOT NULL OR s.rotated_at IS NOT NULL THEN 1 ELSE 0 END AS bit),
                     s.ip
              FROM dbo.admin_sessions s WHERE s.admin_user_id = @id ORDER BY s.created_at DESC"))
        {
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                sessions.Add(new SessionDto(
                    reader.GetFieldValue<DateTimeOffset>(0),
                    reader.GetFieldValue<DateTimeOffset>(1),
                    reader.GetBoolean(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3)));
            }
        }
        active = await CountActiveSessions(db, id, ct);

        return Results.Ok(new AdminDetailDto(row, active, lockedUntil, failedLogins, invitedBy, sessions));
    }

    // ------------------------------------------------------------------ create
    private static async Task<IResult> Create(
        CreateAdminRequest request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, ct);
        if (admin is null) return refusal!;

        var errors = new Dictionary<string, string[]>();
        if (!EmailAddress.TryNormalize(request.Email, out var email)) errors["email"] = ["Enter a valid email address."];
        var name = request.DisplayName?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length < 2) errors["displayName"] = ["Enter the person's name."];
        if (name is { Length: > 200 }) errors["displayName"] = ["Keep the name to 200 characters or fewer."];
        var role = request.Role?.Trim().ToLowerInvariant();
        if (role is not ("admin" or "super_admin")) errors["role"] = ["Choose Admin or Super Admin."];
        if (!AdminPasswords.IsStrongEnough(request.Password))
        {
            errors["password"] = [$"Use at least {AdminPasswords.MinimumLength} characters."];
        }
        else if (request.Password != request.ConfirmPassword)
        {
            errors["confirmPassword"] = ["The two passwords do not match."];
        }
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var hash = AdminPasswords.Hash(request.Password!);

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        long newId;
        await using (var insert = new SqlCommand(
            /* The unique index on email is what actually prevents a duplicate: checking first and
               inserting after is a race, and this runs on a live system. The catch below turns the
               violation into the message the form wants. */
            @"INSERT INTO dbo.admin_users
                  (email, display_name, password_hash, status, password_changed_at,
                   must_change_password, invited_by_admin_id)
              OUTPUT inserted.id
              VALUES (@email, @name, @hash, 'active', SYSDATETIMEOFFSET(), 1, @by)", conn, tx))
        {
            insert.Parameters.AddWithValue("email", email);
            insert.Parameters.AddWithValue("name", name!);
            insert.Parameters.AddWithValue("hash", hash);
            insert.Parameters.AddWithValue("by", admin.Id);
            try
            {
                newId = (long)(await insert.ExecuteScalarAsync(ct))!;
            }
            catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["email"] = ["An administrator with that email address already exists."],
                });
            }
        }

        await using (var assign = new SqlCommand(
            @"INSERT INTO dbo.admin_user_roles (admin_user_id, role_id, assigned_by_admin_id)
              SELECT @admin, r.id, @by FROM dbo.roles r WHERE r.slug = @role", conn, tx))
        {
            assign.Parameters.AddWithValue("admin", newId);
            assign.Parameters.AddWithValue("by", admin.Id);
            assign.Parameters.AddWithValue("role", role!);
            if (await assign.ExecuteNonQueryAsync(ct) == 0)
            {
                return Results.Problem($"The role '{role}' does not exist.", statusCode: StatusCodes.Status409Conflict);
            }
        }

        // The role is recorded; the password is not, in any form.
        await WriteAudit(conn, tx, admin.Id, "admin.created", newId, http, new { email, role }, ct);
        await tx.CommitAsync(ct);

        return Results.Created($"/api/v1/super-admin/admins/{newId}", new PasswordSetDto(newId, request.Password!));
    }

    // ------------------------------------------------------------------ edit
    private static async Task<IResult> Edit(
        long id, EditAdminRequest request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, ct);
        if (admin is null) return refusal!;

        var errors = new Dictionary<string, string[]>();
        if (!EmailAddress.TryNormalize(request.Email, out var email)) errors["email"] = ["Enter a valid email address."];
        var name = request.DisplayName?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length < 2 || name.Length > 200) errors["displayName"] = ["Enter the person's name."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var update = new SqlCommand(
            @"UPDATE dbo.admin_users SET email = @email, display_name = @name, updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.id WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("email", email);
            update.Parameters.AddWithValue("name", name!);
            update.Parameters.AddWithValue("id", id);
            try
            {
                if (await update.ExecuteScalarAsync(ct) is null) return Results.NotFound();
            }
            catch (SqlException ex) when (SqlErrors.IsUniqueViolation(ex))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["email"] = ["Another administrator already uses that email address."],
                });
            }
        }

        await WriteAudit(conn, tx, admin.Id, "admin.details_updated", id, http, new { email }, ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    // ------------------------------------------------------------------ reset someone's password
    private static async Task<IResult> ResetPassword(
        long id, ResetPasswordRequest request, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, ct);
        if (admin is null) return refusal!;

        if (!AdminPasswords.IsStrongEnough(request.Password))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["password"] = [$"Use at least {AdminPasswords.MinimumLength} characters."],
            });
        }
        if (request.Password != request.ConfirmPassword)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["confirmPassword"] = ["The two passwords do not match."],
            });
        }

        /* Resetting your own password here would set must_change_password on yourself and lock you
           out of everything but the change-password screen. Use that screen instead, which asks for
           the current password as it should. */
        if (id == admin.Id)
        {
            return Results.Problem(
                "Use Change my password for your own account.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var hash = AdminPasswords.Hash(request.Password!);

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var update = new SqlCommand(
            @"UPDATE dbo.admin_users
              SET password_hash = @hash,
                  password_changed_at = SYSDATETIMEOFFSET(),
                  must_change_password = 1,
                  failed_login_count = 0,
                  locked_until = NULL,
                  updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.id WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("hash", hash);
            update.Parameters.AddWithValue("id", id);
            if (await update.ExecuteScalarAsync(ct) is null) return Results.NotFound();
        }

        // Every existing session dies: the old password is gone, and so is anything opened with it.
        await RevokeAll(conn, tx, id, ct);
        await WriteAudit(conn, tx, admin.Id, "admin.password_reset", id, http, new { by = admin.Email }, ct);
        await tx.CommitAsync(ct);

        return Results.Ok(new PasswordSetDto(id, request.Password!));
    }

    // ------------------------------------------------------------------ revoke sessions
    private static async Task<IResult> RevokeSessions(
        long id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var (admin, refusal) = await Gate(principal, db, ct);
        if (admin is null) return refusal!;

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        await using (var exists = new SqlCommand("SELECT 1 FROM dbo.admin_users WHERE id = @id", conn, tx))
        {
            exists.Parameters.AddWithValue("id", id);
            if (await exists.ExecuteScalarAsync(ct) is null) return Results.NotFound();
        }

        var ended = await RevokeAll(conn, tx, id, ct);
        await WriteAudit(conn, tx, admin.Id, "admin.sessions_revoked", id, http, new { ended }, ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    // ------------------------------------------------------------------ helpers
    private static async Task<(AdminIdentity? Admin, IResult? Refusal)> Gate(
        ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null) return (null, Results.Unauthorized());
        return AdminAccess.AuthorizeSuper(admin, AdminPermissions.AdminsManage) is { } refusal
            ? (null, refusal)
            : (admin, null);
    }

    private static AdminRowDto ReadRow(SqlDataReader reader, int offset) => new(
        reader.GetInt64(offset),
        reader.GetString(offset + 1),
        reader.GetString(offset + 2),
        reader.GetString(offset + 3),
        reader.IsDBNull(offset + 4) ? [] : reader.GetString(offset + 4).Split(',', StringSplitOptions.RemoveEmptyEntries),
        reader.GetBoolean(offset + 5),
        reader.GetInt32(offset + 6),
        reader.GetBoolean(offset + 7),
        reader.GetBoolean(offset + 8),
        reader.IsDBNull(offset + 9) ? null : reader.GetFieldValue<DateTimeOffset>(offset + 9),
        reader.IsDBNull(offset + 10) ? null : reader.GetFieldValue<DateTimeOffset>(offset + 10),
        reader.GetFieldValue<DateTimeOffset>(offset + 11));

    private static async Task<int> CountMatching(
        SqlDatabase db, string? search, string? status, string? role, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            @"SELECT COUNT(*) FROM dbo.admin_users au
              WHERE (@search IS NULL OR au.display_name LIKE '%' + @search + '%' OR au.email LIKE '%' + @search + '%')
                AND (@status IS NULL OR au.status = @status)
                AND (@role IS NULL OR EXISTS (SELECT 1 FROM dbo.admin_user_roles aur
                                              JOIN dbo.roles r ON r.id = aur.role_id
                                              WHERE aur.admin_user_id = au.id AND r.slug = @role))");
        command.Parameters.Add(new SqlParameter("search", SqlDbType.NVarChar, 200) { Value = (object?)search ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("status", SqlDbType.VarChar, 20)
        {
            Value = status is null or "" or "all" ? DBNull.Value : status,
        });
        command.Parameters.Add(new SqlParameter("role", SqlDbType.VarChar, 50)
        {
            Value = string.IsNullOrWhiteSpace(role) || role == "all" ? DBNull.Value : role.Trim(),
        });
        return (int)(await command.ExecuteScalarAsync(ct))!;
    }

    private static async Task<int> CountActiveSessions(SqlDatabase db, long id, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            @"SELECT COUNT(*) FROM dbo.admin_sessions
              WHERE admin_user_id = @id AND revoked_at IS NULL AND rotated_at IS NULL
                AND expires_at > SYSDATETIMEOFFSET()");
        command.Parameters.AddWithValue("id", id);
        return (int)(await command.ExecuteScalarAsync(ct))!;
    }

    internal static async Task<int> RevokeAll(SqlConnection conn, SqlTransaction tx, long adminId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"UPDATE dbo.admin_sessions SET revoked_at = SYSDATETIMEOFFSET(), revoked_reason = 'revoked_by_super_admin'
              WHERE admin_user_id = @id AND revoked_at IS NULL", conn, tx);
        command.Parameters.AddWithValue("id", adminId);
        return await command.ExecuteNonQueryAsync(ct);
    }

    private static async Task WriteAudit(
        SqlConnection conn, SqlTransaction tx, long actorId, string action, long subjectId,
        HttpContext http, object details, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, details, ip)
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
