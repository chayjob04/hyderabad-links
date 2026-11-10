using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Auth;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Customer login by phone OTP, under /api/v1/auth/customer.
///
/// <para>
/// A customer is somebody who saves businesses and writes reviews. They are <b>not</b> a business
/// owner, and signing in here never makes them one: this creates a row in <c>customers</c>, opens a
/// session in <c>customer_sessions</c>, and issues a token in the <c>customer</c> audience, none of
/// which reaches an owner route. Registering a business is a separate sign-in at
/// /api/v1/auth/owner, which the website offers on its own tab.
/// </para>
/// <para>
/// The same mobile number is allowed in both tables, deliberately: a shopkeeper who also saves
/// other businesses has two accounts and signs in to each. Nothing links them, and nothing should —
/// the whole point of the split is that neither can quietly become the other.
/// </para>
/// <para>
/// The OTP mechanics and the session rules are shared with the owner flow (<see cref="OtpFlow"/>,
/// <see cref="SessionStore"/>), so rate limits, attempt counting and refresh-token theft detection
/// are literally the same code. Only the purpose, the identity table and the audience differ.
/// </para>
/// </summary>
public static class CustomerAuthEndpoints
{
    public static RouteGroupBuilder MapCustomerAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/auth/customer");
        group.MapPost("/otp/request", RequestOtp);
        group.MapPost("/otp/verify", VerifyOtp);
        group.MapPost("/refresh", Refresh);
        group.MapPost("/logout", Logout);
        return group;
    }

    // ------------------------------------------------------------------ request a code
    private static async Task<IResult> RequestOtp(
        OwnerAuthEndpoints.RequestOtpRequest request,
        HttpContext http,
        SqlDatabase db,
        AuthSettings settings,
        ISmsSender sms,
        ILogger<Program> logger,
        CancellationToken ct)
    {
        if (!PhoneNumber.TryNormalizeIndia(request.Phone, out var phone))
        {
            return Results.Problem("Enter a valid 10-digit Indian mobile number.", statusCode: StatusCodes.Status400BadRequest);
        }

        var refusal = await OtpFlow.SendCode(OtpFlow.CustomerPurpose, phone, http, db, settings, sms, logger, ct);
        if (refusal is not null)
        {
            return refusal;
        }

        // Same response whether or not the number already has an account.
        return Results.Accepted(value: new OwnerAuthEndpoints.OtpRequestedDto(settings.OtpTtlSeconds, settings.ResendCooldownSeconds));
    }

    // ------------------------------------------------------------------ verify the code
    private static async Task<IResult> VerifyOtp(
        OwnerAuthEndpoints.VerifyOtpRequest request,
        HttpContext http,
        SqlDatabase db,
        AuthSettings settings,
        TokenService tokens,
        CancellationToken ct)
    {
        if (!PhoneNumber.TryNormalizeIndia(request.Phone, out var phone) || !OtpCodes.IsWellFormed(request.Code))
        {
            return Results.Problem(OwnerAuthEndpoints.InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var outcome = await OtpFlow.ConsumeCode(OtpFlow.CustomerPurpose, phone, request.Code!, conn, tx, settings, ct);
        if (outcome is OtpFlow.CodeOutcome.RejectedAfterAttempt)
        {
            // The attempt counter must survive a wrong guess, or rolling back buys unlimited tries.
            await tx.CommitAsync(ct);
            return Results.Problem(OwnerAuthEndpoints.InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
        }
        if (outcome is not OtpFlow.CodeOutcome.Ok)
        {
            return Results.Problem(OwnerAuthEndpoints.InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
        }

        // First successful login creates the customer account. Same two-statement upsert the owner
        // flow uses, against the other table; the unique constraint on phone_e164 is still what
        // decides a race between two sign-ins for one number.
        long customerId;
        string status;
        await using (var upsert = new SqlCommand(
            @"UPDATE customers
              SET phone_verified_at = COALESCE(phone_verified_at, SYSDATETIMEOFFSET()),
                  updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.id, inserted.status
              WHERE phone_e164 = @phone;

              INSERT INTO customers (phone_e164, phone_verified_at)
              OUTPUT inserted.id, inserted.status
              SELECT @phone, SYSDATETIMEOFFSET()
              WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone_e164 = @phone)", conn, tx))
        {
            upsert.Parameters.AddWithValue("phone", phone);
            await using var reader = await upsert.ExecuteReaderAsync(ct);

            // Two statements, so two result sets, and the one that did nothing is empty.
            while (!await reader.ReadAsync(ct))
            {
                if (!await reader.NextResultAsync(ct))
                {
                    throw new InvalidOperationException("The customer sign-in upsert produced no row.");
                }
            }

            customerId = reader.GetInt64(0);
            status = reader.GetString(1);
        }

        if (status != "active")
        {
            await tx.CommitAsync(ct);
            return Results.Problem("This account cannot sign in.", statusCode: StatusCodes.Status403Forbidden);
        }

        var refreshToken = TokenService.NewRefreshToken();
        await SessionStore.Customer.Create(conn, tx, customerId, refreshToken, settings, http, ct);
        await tx.CommitAsync(ct);

        var (accessToken, expiresIn) = tokens.CreateCustomerAccessToken(customerId);
        return Results.Ok(new OwnerAuthEndpoints.SessionDto(accessToken, refreshToken, expiresIn));
    }

    // ------------------------------------------------------------------ rotate the refresh token
    private static async Task<IResult> Refresh(
        OwnerAuthEndpoints.RefreshRequest request,
        HttpContext http,
        SqlDatabase db,
        AuthSettings settings,
        TokenService tokens,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken) || request.RefreshToken.Length > 200)
        {
            return Results.Unauthorized();
        }

        var rotated = await SessionStore.Customer.Rotate(request.RefreshToken, db, settings, http, ct);
        if (rotated is null)
        {
            return Results.Unauthorized();
        }

        var (accessToken, expiresIn) = tokens.CreateCustomerAccessToken(rotated.SubjectId);
        return Results.Ok(new OwnerAuthEndpoints.SessionDto(accessToken, rotated.RefreshToken, expiresIn));
    }

    // ------------------------------------------------------------------ sign out
    private static async Task<IResult> Logout(
        OwnerAuthEndpoints.RefreshRequest request, SqlDatabase db, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(request.RefreshToken) && request.RefreshToken.Length <= 200)
        {
            await SessionStore.Customer.Revoke(request.RefreshToken, db, ct);
        }

        // Always 204, so the endpoint cannot be used to test whether a token exists.
        return Results.NoContent();
    }
}
