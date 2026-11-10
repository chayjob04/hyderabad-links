using System.Data;
using System.Net;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Everything a signed-in customer can do, under /api/v1/customer. Every route requires a customer
/// access token, pinned to <see cref="CustomerAccess.Scheme"/> by the policy, so an owner token is
/// refused here and a customer token is refused on /api/v1/me.
///
/// <para>
/// There is deliberately no onboarding, no listings, no enquiries and no plans. A customer saves
/// businesses, writes reviews and keeps a name and an email, and that is the whole surface. Wanting
/// to list a business means signing in on the owner tab, which creates an owner account of its own.
/// </para>
/// </summary>
public static class CustomerEndpoints
{
    /// <summary>
    /// Note what is missing next to the owner's MeDto: there is no NeedsOnboarding. A customer never
    /// onboards, and an unnamed customer is a perfectly finished account.
    /// </summary>
    public sealed record CustomerDto(long Id, string Phone, string? Name, string? Email);

    public static RouteGroupBuilder MapCustomerEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/customer").RequireAuthorization(CustomerAccess.Policy);
        group.MapGet("", GetMe);
        group.MapPut("/profile", UpdateProfile);
        group.MapFavouriteEndpoints();
        group.MapCustomerReviewEndpoints();
        return group;
    }

    private static async Task<IResult> GetMe(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!CustomerAccess.TryGetCustomerId(principal, out var customerId))
        {
            return Results.Unauthorized();
        }

        await using var command = db.CreateCommand(
            "SELECT phone_e164, name, email FROM customers WHERE id = @id AND status = 'active'");
        command.Parameters.AddWithValue("id", customerId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return Results.Unauthorized();
        }

        return Results.Ok(new CustomerDto(
            customerId,
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2)));
    }

    /// <summary>
    /// The customer's own name and email. The phone number is not editable: it is the identity the
    /// OTP flow verified, and changing it would mean verifying a new one.
    /// </summary>
    private static async Task<IResult> UpdateProfile(
        OwnerProfileEndpoints.ProfileRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!CustomerAccess.TryGetCustomerId(principal, out var customerId))
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
            @"UPDATE customers SET name = @name, email = @email, updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.phone_e164
              WHERE id = @id AND status = 'active'", conn, tx))
        {
            update.Parameters.AddWithValue("name", valid.Name);
            update.Parameters.AddWithValue("email", valid.Email);
            update.Parameters.AddWithValue("id", customerId);
            if (await update.ExecuteScalarAsync(ct) is not string storedPhone)
            {
                // A valid token for a customer who is gone or suspended.
                return Results.Unauthorized();
            }
            phone = storedPhone;
        }

        // What changed is not recorded, only that it did: the name and email are personal data and
        // the audit log is read by administrators.
        await using (var audit = new SqlCommand(
            @"INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, ip)
              VALUES ('customer', @customer, 'customer.profile_updated', 'customer', @entity, @ip)", conn, tx))
        {
            IPAddress? ip = http.Connection.RemoteIpAddress;
            audit.Parameters.AddWithValue("customer", customerId);
            audit.Parameters.AddWithValue("entity", customerId.ToString());
            audit.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
            await audit.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return Results.Ok(new OwnerProfileEndpoints.ProfileDto(phone, valid.Name, valid.Email));
    }
}
