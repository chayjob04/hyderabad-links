using BusinessDirectory.Api.Data;
using System.Data;
using System.Net;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// The owner's own details, under /api/v1/me/profile.
///
/// Onboarding fills these in once and is guarded by `name IS NULL` so a repeated registration can
/// never overwrite a profile. That guard is what makes this endpoint necessary: without it the
/// owner would have no way to correct a typo in their own name or change their email address.
///
/// The phone number is **not** editable here. It is the identity the OTP flow verified, and
/// changing it would mean re-verifying the new number — a separate flow, not a profile edit.
/// </summary>
public static class OwnerProfileEndpoints
{
    public sealed record ProfileRequest(string? Name, string? Email);

    public sealed record ProfileDto(string Phone, string Name, string Email);

    public static RouteGroupBuilder MapOwnerProfileEndpoints(this RouteGroupBuilder group)
    {
        group.MapPut("/profile", UpdateProfile);
        return group;
    }

    private static async Task<IResult> UpdateProfile(
        ProfileRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        var profile = ProfileValidator.Validate(new ProfileInput(request.Name, request.Email));
        if (profile.Value is not { } valid)
        {
            return Results.ValidationProblem(profile.Errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        string phone;
        await using (var update = new SqlCommand(
            /* OUTPUT is SQL Server's RETURNING, and it goes before the WHERE rather than after it.
               "inserted" is the row as it now stands, which is what the old RETURNING gave back. */
            @"UPDATE dbo.users SET name = @name, email = @email, updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.phone_e164
              WHERE id = @id AND status = 'active'", conn, tx))
        {
            update.Parameters.AddWithValue("name", valid.Name);
            update.Parameters.AddWithValue("email", valid.Email);
            update.Parameters.AddWithValue("id", userId);
            if (await update.ExecuteScalarAsync(ct) is not string storedPhone)
            {
                // A valid token for a user who is gone or suspended.
                return Results.Unauthorized();
            }
            phone = storedPhone;
        }

        // What changed is not recorded, only that it did: the name and email are personal data and
        // the audit log is read by administrators.
        await using (var audit = new SqlCommand(
            @"INSERT INTO dbo.audit_logs (actor_type, actor_id, action, entity_type, entity_id, ip)
              VALUES ('owner', @user, 'owner.profile_updated', 'user', @entity, @ip)", conn, tx))
        {
            IPAddress? ip = http.Connection.RemoteIpAddress;
            audit.Parameters.AddWithValue("user", userId);
            audit.Parameters.AddWithValue("entity", userId.ToString());
            audit.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
            await audit.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return Results.Ok(new ProfileDto(phone, valid.Name, valid.Email));
    }
}
