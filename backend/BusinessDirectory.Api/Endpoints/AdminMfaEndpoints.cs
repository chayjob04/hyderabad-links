using BusinessDirectory.Api.Data;
using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// The second step of an admin sign-in, under /api/v1/auth/admin/mfa.
///
/// This is where an admin session is actually created. The password step issues only a short-lived
/// token on a different audience, so until one of these endpoints succeeds there is no refresh token
/// and no token that any admin route will accept.
///
/// Three endpoints, each reachable by exactly one kind of token:
///   enroll/start, enroll/confirm  - the "enroll" audience: no authenticator set up yet
///   verify                        - the "mfa" audience: authenticator set up, code awaited
/// </summary>
public static class AdminMfaEndpoints
{
    public sealed record VerifyRequest(string? Code, string? RecoveryCode);

    public sealed record ConfirmRequest(string? Code);

    /// <param name="Secret">Base32, for typing in by hand when a QR code cannot be scanned.</param>
    /// <param name="OtpauthUri">What a QR code would encode.</param>
    public sealed record EnrollmentDto(string Secret, string OtpauthUri);

    /// <param name="RecoveryCodes">Returned once, at enrollment, and never retrievable again.</param>
    public sealed record EnrolledDto(
        string AccessToken,
        string RefreshToken,
        int ExpiresInSeconds,
        IReadOnlyList<string> RecoveryCodes,
        string? SuperAdminAccessToken = null);

    /// <summary>One message for a wrong code, a reused code and a spent recovery code.</summary>
    private const string FailedMessage = "That code is not valid. Check your authenticator and try again.";

    private const string LockedMessage = "Too many incorrect codes. Please sign in again later.";

    public static RouteGroupBuilder MapAdminMfaEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/mfa/verify", Verify).RequireAuthorization(AdminAccess.MfaPolicy);
        group.MapPost("/mfa/enroll/start", StartEnrollment).RequireAuthorization(AdminAccess.EnrollPolicy);
        group.MapPost("/mfa/enroll/confirm", ConfirmEnrollment).RequireAuthorization(AdminAccess.EnrollPolicy);
        return group;
    }

    // ------------------------------------------------------------------ enrollment
    /// <summary>
    /// Produces a secret and stores it sealed, leaving `totp_enabled_at` null. The account is not
    /// protected by it until a code proves the authenticator actually holds the same secret, so an
    /// abandoned enrollment cannot lock anyone out.
    /// </summary>
    private static async Task<IResult> StartEnrollment(
        ClaimsPrincipal principal,
        SqlDatabase db,
        AuthSettings settings,
        TotpSecrets secrets,
        CancellationToken ct)
    {
        if (!AdminAccess.TryGetAdminId(principal, out var adminId))
        {
            return Results.Unauthorized();
        }

        var secret = Totp.NewSecret();

        await using var command = db.CreateCommand(
            @"UPDATE dbo.admin_users
              SET totp_secret_encrypted = @secret, updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.email
              WHERE id = @id AND status = 'active' AND totp_enabled_at IS NULL");
        command.Parameters.Add(new SqlParameter("secret", SqlDbType.VarBinary) { Value = secrets.Seal(secret) });
        command.Parameters.AddWithValue("id", adminId);

        // No row means the account is disabled, or already enrolled and must not be re-enrolled by
        // this route: changing an existing authenticator is a signed-in action, not a sign-in one.
        if (await command.ExecuteScalarAsync(ct) is not string email)
        {
            return Results.Unauthorized();
        }

        return Results.Ok(new EnrollmentDto(Base32.Encode(secret), Totp.EnrollmentUri(settings.Issuer, email, secret)));
    }

    /// <summary>
    /// Checks the first code from the new authenticator. On success it enables MFA, issues the
    /// recovery codes and opens the session, so enrolling and signing in are one step for the admin.
    /// </summary>
    private static async Task<IResult> ConfirmEnrollment(
        ConfirmRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        AuthSettings settings,
        TokenService tokens,
        TotpSecrets secrets,
        CancellationToken ct)
    {
        if (!AdminAccess.TryGetAdminId(principal, out var adminId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var state = await LoadForMfa(conn, tx, adminId, ct);
        if (state is null || state.Locked)
        {
            return Results.Problem(state is null ? FailedMessage : LockedMessage, statusCode: StatusCodes.Status401Unauthorized);
        }
        if (state.TotpEnabled)
        {
            return Results.Unauthorized();   // already enrolled; nothing to confirm
        }

        var secret = secrets.TryOpen(state.SealedSecret);
        if (secret is null || !Totp.TryVerify(secret, request.Code, DateTimeOffset.UtcNow, state.LastStep, out var matchedStep))
        {
            await CountFailure(conn, tx, adminId, settings, ct);
            await AdminAuthEndpoints.WriteAudit(conn, tx, adminId, "admin.mfa_enroll_failed", http, details: null, ct);
            await tx.CommitAsync(ct);
            return Results.Problem(FailedMessage, statusCode: StatusCodes.Status401Unauthorized);
        }

        // The confirming code is spent too, so it cannot be replayed straight into a second session.
        await RecordUsedStep(conn, tx, adminId, matchedStep, ct);

        await using (var enable = new SqlCommand(
            @"UPDATE dbo.admin_users
              SET totp_enabled_at = SYSDATETIMEOFFSET(), failed_login_count = 0, locked_until = NULL, updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            enable.Parameters.AddWithValue("id", adminId);
            await enable.ExecuteNonQueryAsync(ct);
        }

        // A fresh set replaces anything left from a previous enrollment.
        await using (var clear = new SqlCommand("DELETE FROM dbo.admin_recovery_codes WHERE admin_user_id = @id", conn, tx))
        {
            clear.Parameters.AddWithValue("id", adminId);
            await clear.ExecuteNonQueryAsync(ct);
        }

        var codes = RecoveryCodes.Generate();
        foreach (var code in codes)
        {
            await using var insert = new SqlCommand(
                "INSERT INTO dbo.admin_recovery_codes (admin_user_id, code_hash) VALUES (@id, @hash)", conn, tx);
            insert.Parameters.AddWithValue("id", adminId);
            insert.Parameters.Add(new SqlParameter("hash", SqlDbType.VarBinary) { Value = RecoveryCodes.Hash(code) });
            await insert.ExecuteNonQueryAsync(ct);
        }

        var session = await OpenSession(conn, tx, adminId, settings, http, tokens, ct);
        await AdminAuthEndpoints.WriteAudit(conn, tx, adminId, "admin.mfa_enrolled", http, details: null, ct);
        await tx.CommitAsync(ct);

        return Results.Ok(new EnrolledDto(
            session.AccessToken, session.RefreshToken, session.ExpiresInSeconds, codes, session.SuperAdminAccessToken));
    }

    // ------------------------------------------------------------------ verification
    private static async Task<IResult> Verify(
        VerifyRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        AuthSettings settings,
        TokenService tokens,
        TotpSecrets secrets,
        CancellationToken ct)
    {
        if (!AdminAccess.TryGetAdminId(principal, out var adminId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var state = await LoadForMfa(conn, tx, adminId, ct);
        if (state is null)
        {
            return Results.Problem(FailedMessage, statusCode: StatusCodes.Status401Unauthorized);
        }
        if (state.Locked)
        {
            return Results.Problem(LockedMessage, statusCode: StatusCodes.Status401Unauthorized);
        }
        if (!state.TotpEnabled)
        {
            return Results.Unauthorized();   // nothing to verify against yet
        }

        var usedRecoveryCode = false;

        if (!string.IsNullOrWhiteSpace(request.RecoveryCode))
        {
            usedRecoveryCode = await TrySpendRecoveryCode(conn, tx, adminId, request.RecoveryCode, ct);
            if (!usedRecoveryCode)
            {
                await CountFailure(conn, tx, adminId, settings, ct);
                await AdminAuthEndpoints.WriteAudit(conn, tx, adminId, "admin.mfa_failed", http, new { method = "recovery_code" }, ct);
                await tx.CommitAsync(ct);
                return Results.Problem(FailedMessage, statusCode: StatusCodes.Status401Unauthorized);
            }
        }
        else
        {
            var secret = secrets.TryOpen(state.SealedSecret);

            if (secret is null || !Totp.TryVerify(secret, request.Code, DateTimeOffset.UtcNow, state.LastStep, out var matchedStep))
            {
                await CountFailure(conn, tx, adminId, settings, ct);
                await AdminAuthEndpoints.WriteAudit(conn, tx, adminId, "admin.mfa_failed", http, new { method = "totp" }, ct);
                await tx.CommitAsync(ct);
                return Results.Problem(FailedMessage, statusCode: StatusCodes.Status401Unauthorized);
            }

            await RecordUsedStep(conn, tx, adminId, matchedStep, ct);
        }

        await using (var reset = new SqlCommand(
            @"UPDATE dbo.admin_users
              SET failed_login_count = 0, locked_until = NULL, last_login_at = SYSDATETIMEOFFSET(), updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            reset.Parameters.AddWithValue("id", adminId);
            await reset.ExecuteNonQueryAsync(ct);
        }

        var session = await OpenSession(conn, tx, adminId, settings, http, tokens, ct);
        await AdminAuthEndpoints.WriteAudit(conn, tx, adminId, "admin.signed_in", http,
            new { method = usedRecoveryCode ? "recovery_code" : "totp" }, ct);
        await tx.CommitAsync(ct);

        return Results.Ok(new AdminAuthEndpoints.SessionDto(
            session.AccessToken, session.RefreshToken, session.ExpiresInSeconds, session.SuperAdminAccessToken));
    }

    // ------------------------------------------------------------------ helpers
    private sealed record MfaState(byte[]? SealedSecret, bool TotpEnabled, bool Locked, long? LastStep);

    /// <summary>
    /// Everything the second step needs, with the account row locked so concurrent attempts are
    /// counted one at a time.
    /// </summary>
    private static async Task<MfaState?> LoadForMfa(SqlConnection conn, SqlTransaction tx, long adminId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            /* The row is locked as it is read, so two requests for the same one queue rather than
               both acting on what they saw. PostgreSQL wrote that as FOR UPDATE after the query;
               SQL Server puts it on the table as a hint. HOLDLOCK keeps it to the end of the
               transaction, which is what FOR UPDATE did. */
            @"SELECT totp_secret_encrypted,
                     CAST(CASE WHEN totp_enabled_at IS NOT NULL THEN 1 ELSE 0 END AS bit),
                     CAST(CASE WHEN locked_until > SYSDATETIMEOFFSET() THEN 1 ELSE 0 END AS bit),
                     totp_last_step
              FROM dbo.admin_users WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE id = @id AND status = 'active'", conn, tx);
        command.Parameters.AddWithValue("id", adminId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new MfaState(
            reader.IsDBNull(0) ? null : reader.GetFieldValue<byte[]>(0),
            reader.GetBoolean(1),
            reader.GetBoolean(2),
            reader.IsDBNull(3) ? null : reader.GetInt64(3));
    }

    /// <summary>
    /// Records which step the accepted code belonged to, so that code cannot be presented again.
    /// The step comes from the verification itself, never from the clock: a code accepted from the
    /// next step (allowed, for drift) belongs to a later step than "now", and inferring it from a
    /// timestamp therefore leaves that code replayable.
    /// </summary>
    private static async Task RecordUsedStep(
        SqlConnection conn,
        SqlTransaction tx,
        long adminId,
        long step,
        CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "UPDATE dbo.admin_users SET totp_last_step = @step, updated_at = SYSDATETIMEOFFSET() WHERE id = @id", conn, tx);
        command.Parameters.AddWithValue("step", step);
        command.Parameters.AddWithValue("id", adminId);
        await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Marks one unused recovery code as spent. The UPDATE itself is the test: it matches only a row
    /// that is still unused, so two requests racing with the same code cannot both succeed.
    /// </summary>
    private static async Task<bool> TrySpendRecoveryCode(
        SqlConnection conn,
        SqlTransaction tx,
        long adminId,
        string code,
        CancellationToken ct)
    {
        if (code.Length > 64)
        {
            return false;
        }

        await using var command = new SqlCommand(
            /* Spends one recovery code, and only one, even if two requests arrive at the same
               moment with the same code.

               PostgreSQL did it with FOR UPDATE SKIP LOCKED inside the subquery. SQL Server's
               equivalent hints are UPDLOCK (take the write lock while reading) and READPAST (step
               over rows another transaction already has), and the TOP (1) replaces LIMIT.

               The real guarantee is the same as before and does not depend on the hints: the
               UPDATE only matches a row whose used_at is still null, so whichever transaction
               gets there second updates nothing and the caller is told the code is spent. */
            @"UPDATE dbo.admin_recovery_codes
              SET used_at = SYSDATETIMEOFFSET()
              WHERE id = (SELECT TOP (1) id
                          FROM dbo.admin_recovery_codes WITH (UPDLOCK, READPAST, ROWLOCK)
                          WHERE admin_user_id = @id AND code_hash = @hash AND used_at IS NULL)
                AND used_at IS NULL", conn, tx);
        command.Parameters.AddWithValue("id", adminId);
        command.Parameters.Add(new SqlParameter("hash", SqlDbType.VarBinary) { Value = RecoveryCodes.Hash(code) });
        return await command.ExecuteNonQueryAsync(ct) == 1;
    }

    /// <summary>Counts a wrong code against the same allowance and lockout as a wrong password.</summary>
    private static async Task CountFailure(
        SqlConnection conn,
        SqlTransaction tx,
        long adminId,
        AuthSettings settings,
        CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"UPDATE dbo.admin_users
              SET failed_login_count = failed_login_count + 1,
                  locked_until = CASE WHEN failed_login_count + 1 >= @max
                                      THEN DATEADD(minute, @lockMinutes, SYSDATETIMEOFFSET())
                                      ELSE locked_until END,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx);
        command.Parameters.AddWithValue("id", adminId);
        command.Parameters.AddWithValue("max", settings.AdminMaxMfaAttempts);
        command.Parameters.AddWithValue("lockMinutes", settings.AdminLockoutMinutes);   // int: see AdminAuthEndpoints
        await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Creates the session row, stamping the moment MFA completed, and mints the real tokens.</summary>
    private static async Task<(string AccessToken, string RefreshToken, int ExpiresInSeconds, string? SuperAdminAccessToken)> OpenSession(
        SqlConnection conn,
        SqlTransaction tx,
        long adminId,
        AuthSettings settings,
        HttpContext http,
        TokenService tokens,
        CancellationToken ct)
    {
        var refreshToken = TokenService.NewRefreshToken();
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.admin_sessions (admin_user_id, refresh_token_hash, expires_at, last_mfa_at, ip, user_agent)
              VALUES (@admin, @hash, DATEADD(day, @days, SYSDATETIMEOFFSET()), SYSDATETIMEOFFSET(), @ip, @ua)", conn, tx))
        {
            AdminAuthEndpoints.AddSessionParameters(insert, adminId, refreshToken, settings, http);
            await insert.ExecuteNonQueryAsync(ct);
        }

        var (accessToken, expiresIn) = tokens.CreateAdminAccessToken(adminId);

        // A super admin gets a second token, on its own audience, for /api/v1/super-admin. An
        // ordinary administrator gets none, so nothing they hold is accepted there at all.
        var superToken = await AdminAccess.HoldsSuperAdmin(conn, tx, adminId, ct)
            ? tokens.CreateSuperAdminAccessToken(adminId).Token
            : null;

        return (accessToken, refreshToken, expiresIn, superToken);
    }
}
