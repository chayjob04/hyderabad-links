using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Changing your own password, at <c>POST /api/v1/admin/me/password</c> and the identical route
/// under <c>/api/v1/super-admin</c>.
///
/// <para>
/// It is mounted on <b>both</b> staff surfaces, because a session holds one audience or the other:
/// an ordinary administrator has no super-admin token, and somebody who signed in on the
/// super-admin tab has no admin token. Either way they must be able to change their own password.
/// Mounting it twice grants nothing, because the handler acts on the subject id inside the token
/// and can reach no other account.
/// </para>
/// <para>
/// It deliberately requires <b>no permission</b>, and so does not go through
/// <see cref="AdminAccess.Authorize"/>. That is what keeps it reachable while
/// <c>must_change_password</c> is set and everything else is refused: an account on a temporary
/// password can do exactly one thing, which is stop being on one. Authentication is the whole
/// control here — the subject id comes from the validated token, so you can only ever change your
/// own password, and the current one has to be presented as well.
/// </para>
/// <para>
/// MFA is untouched. This is reached only with a full admin access token, which is issued after the
/// authenticator code has been accepted.
/// </para>
/// </summary>
public static class AdminPasswordEndpoints
{
    public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword, string? ConfirmPassword);

    /// <param name="MustChangePassword">False once this succeeds. The staff site reads it to lift its own block.</param>
    public sealed record PasswordStateDto(bool MustChangePassword);

    public static RouteGroupBuilder MapAdminPasswordEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/me/password", GetState);
        group.MapPost("/me/password", ChangePassword);
        return group;
    }

    /// <summary>Whether this account is still on a password somebody else chose for it.</summary>
    private static async Task<IResult> GetState(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!AdminAccess.TryGetAdminId(principal, out var adminId))
        {
            return Results.Unauthorized();
        }

        await using var command = db.CreateCommand(
            "SELECT must_change_password FROM dbo.admin_users WHERE id = @id AND status = 'active'");
        command.Parameters.AddWithValue("id", adminId);
        var value = await command.ExecuteScalarAsync(ct);
        return value is bool must ? Results.Ok(new PasswordStateDto(must)) : Results.Unauthorized();
    }

    private static async Task<IResult> ChangePassword(
        ChangePasswordRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!AdminAccess.TryGetAdminId(principal, out var adminId))
        {
            return Results.Unauthorized();
        }

        var errors = new Dictionary<string, string[]>();
        if (!AdminPasswords.IsStrongEnough(request.NewPassword))
        {
            errors["newPassword"] = [$"Use at least {AdminPasswords.MinimumLength} characters."];
        }
        else if (request.NewPassword != request.ConfirmPassword)
        {
            errors["confirmPassword"] = ["The two passwords do not match."];
        }
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        string? storedHash;
        await using (var find = new SqlCommand(
            "SELECT password_hash FROM dbo.admin_users WHERE id = @id AND status = 'active'", conn, tx))
        {
            find.Parameters.AddWithValue("id", adminId);
            storedHash = await find.ExecuteScalarAsync(ct) as string;
        }

        /* Verified even when there is no stored hash, against a decoy, so that an account in the
           invited state takes the same time to refuse as a real one. The same reasoning as the
           sign-in endpoint's. */
        if (storedHash is null)
        {
            AdminPasswords.VerifyAgainstDecoy(request.CurrentPassword);
            return Results.Unauthorized();
        }
        if (!AdminPasswords.Verify(request.CurrentPassword, storedHash))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["currentPassword"] = ["That is not your current password."],
            });
        }
        if (AdminPasswords.Verify(request.NewPassword, storedHash))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["newPassword"] = ["Choose a password you have not just been using."],
            });
        }

        await using (var update = new SqlCommand(
            @"UPDATE dbo.admin_users
              SET password_hash = @hash,
                  password_changed_at = SYSDATETIMEOFFSET(),
                  must_change_password = 0,
                  failed_login_count = 0,
                  locked_until = NULL,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("hash", AdminPasswords.Hash(request.NewPassword!));
            update.Parameters.AddWithValue("id", adminId);
            await update.ExecuteNonQueryAsync(ct);
        }

        /* Every other session is ended, and this one is left alone. Changing a password is what
           somebody does after they fear it was seen, so the other sessions have to go -- but
           signing the person out of the window they are standing in would be gratuitous. */
        await using (var revoke = new SqlCommand(
            @"UPDATE dbo.admin_sessions
              SET revoked_at = SYSDATETIMEOFFSET(), revoked_reason = 'password_changed'
              WHERE admin_user_id = @id AND revoked_at IS NULL
                AND id <> ISNULL(@current, -1)", conn, tx))
        {
            revoke.Parameters.AddWithValue("id", adminId);
            // There is no session id on the access token, so every session goes. The caller keeps
            // its access token until it expires and then has to sign in again, which is acceptable
            // for an action this rare.
            revoke.Parameters.Add(new SqlParameter("current", SqlDbType.BigInt) { Value = DBNull.Value });
            await revoke.ExecuteNonQueryAsync(ct);
        }

        // The action is recorded; neither password is, in any form.
        await using (var audit = new SqlCommand(
            @"INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, ip)
              VALUES ('admin', @actor, 'admin.password_changed', 'admin_user', @entity, @ip)", conn, tx))
        {
            audit.Parameters.AddWithValue("actor", adminId);
            audit.Parameters.AddWithValue("entity", adminId.ToString(System.Globalization.CultureInfo.InvariantCulture));
            audit.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar)
            {
                Value = (object?)http.Connection.RemoteIpAddress?.ToString() ?? DBNull.Value,
            });
            await audit.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return Results.Ok(new PasswordStateDto(false));
    }
}
