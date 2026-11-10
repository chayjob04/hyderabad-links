using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Auth;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Business-owner login by phone OTP, under /api/v1/auth/owner. Raw parameterised SQL, no ORM.
/// Rate limits live in SQL Server (counted from otp_challenges), so they hold across several API instances.
/// The browser never calls these directly: the Next.js server calls them and keeps the tokens in httpOnly cookies.
///
/// <para>
/// This is the <b>owner</b> sign-in and it creates an owner account, in <c>users</c>. Customers sign
/// in at /api/v1/auth/customer into <c>customers</c>, with their own OTP purpose, their own session
/// table and their own token audience. Signing in here does not create a customer, and signing in
/// there does not create an owner: that separation is the point, and the same mobile number may do
/// both independently.
/// </para>
/// <para>
/// The OTP mechanics and the session rules are in <see cref="OtpFlow"/> and
/// <see cref="SessionStore"/>, shared with the customer flow so the two cannot drift apart.
/// </para>
/// </summary>
public static class OwnerAuthEndpoints
{
    public sealed record RequestOtpRequest(string? Phone);

    public sealed record VerifyOtpRequest(string? Phone, string? Code);

    public sealed record RefreshRequest(string? RefreshToken);

    public sealed record OtpRequestedDto(int ExpiresInSeconds, int ResendAfterSeconds);

    public sealed record SessionDto(string AccessToken, string RefreshToken, int ExpiresInSeconds);

    internal const string InvalidCodeMessage = "The code is invalid or has expired.";

    public static RouteGroupBuilder MapOwnerAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/auth/owner");
        group.MapPost("/otp/request", RequestOtp);
        group.MapPost("/otp/verify", VerifyOtp);
        group.MapPost("/refresh", Refresh);
        group.MapPost("/logout", Logout);
        return group;
    }

    // ------------------------------------------------------------------ request a code
    private static async Task<IResult> RequestOtp(
        RequestOtpRequest request,
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

        var refusal = await OtpFlow.SendCode(OtpFlow.OwnerPurpose, phone, http, db, settings, sms, logger, ct);
        if (refusal is not null)
        {
            return refusal;
        }

        // Same response whether or not the number already has an account.
        return Results.Accepted(value: new OtpRequestedDto(settings.OtpTtlSeconds, settings.ResendCooldownSeconds));
    }

    // ------------------------------------------------------------------ verify the code
    private static async Task<IResult> VerifyOtp(
        VerifyOtpRequest request,
        HttpContext http,
        SqlDatabase db,
        AuthSettings settings,
        TokenService tokens,
        CancellationToken ct)
    {
        if (!PhoneNumber.TryNormalizeIndia(request.Phone, out var phone) || !OtpCodes.IsWellFormed(request.Code))
        {
            return Results.Problem(InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        var outcome = await OtpFlow.ConsumeCode(OtpFlow.OwnerPurpose, phone, request.Code!, conn, tx, settings, ct);
        if (outcome is OtpFlow.CodeOutcome.RejectedAfterAttempt)
        {
            // The attempt counter must survive a wrong guess, or rolling back buys unlimited tries.
            await tx.CommitAsync(ct);
            return Results.Problem(InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
        }
        if (outcome is not OtpFlow.CodeOutcome.Ok)
        {
            return Results.Problem(InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
        }

        // First successful login creates the owner account.
        long userId;
        string userStatus;
        await using (var upsert = new SqlCommand(
            /* "create the account on first sign-in, otherwise stamp the existing one", which
               PostgreSQL wrote as ON CONFLICT ... DO UPDATE.

               The UPDATE runs first and outputs the row when there was one; the INSERT runs only
               when it did not, and outputs the new row. Exactly one of them produces a row, so the
               reader below still reads one. The unique constraint on phone_e164 remains the real
               guard if two sign-ins for one number arrive together: the loser gets a duplicate-key
               error and retries into the UPDATE branch.

               COALESCE keeps the original verification moment rather than moving it forward. */
            @"UPDATE users
              SET phone_verified_at = COALESCE(phone_verified_at, SYSDATETIMEOFFSET()),
                  updated_at = SYSDATETIMEOFFSET()
              OUTPUT inserted.id, inserted.status
              WHERE phone_e164 = @phone;

              INSERT INTO users (phone_e164, phone_verified_at)
              OUTPUT inserted.id, inserted.status
              SELECT @phone, SYSDATETIMEOFFSET()
              WHERE NOT EXISTS (SELECT 1 FROM users WHERE phone_e164 = @phone)", conn, tx))
        {
            upsert.Parameters.AddWithValue("phone", phone);
            await using var reader = await upsert.ExecuteReaderAsync(ct);

            /* Two statements, so two result sets, and the one that did nothing is empty. Whichever
               ran is the one with a row in it, so walk forward until a row appears. */
            while (!await reader.ReadAsync(ct))
            {
                if (!await reader.NextResultAsync(ct))
                {
                    throw new InvalidOperationException("The sign-in upsert produced no row.");
                }
            }

            userId = reader.GetInt64(0);
            userStatus = reader.GetString(1);
        }

        if (userStatus != "active")
        {
            await tx.CommitAsync(ct);
            return Results.Problem("This account cannot sign in.", statusCode: StatusCodes.Status403Forbidden);
        }

        var refreshToken = TokenService.NewRefreshToken();
        await SessionStore.Owner.Create(conn, tx, userId, refreshToken, settings, http, ct);
        await tx.CommitAsync(ct);

        var (accessToken, expiresIn) = tokens.CreateAccessToken(userId);
        return Results.Ok(new SessionDto(accessToken, refreshToken, expiresIn));
    }

    // ------------------------------------------------------------------ rotate the refresh token
    private static async Task<IResult> Refresh(
        RefreshRequest request,
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

        var rotated = await SessionStore.Owner.Rotate(request.RefreshToken, db, settings, http, ct);
        if (rotated is null)
        {
            return Results.Unauthorized();
        }

        var (accessToken, expiresIn) = tokens.CreateAccessToken(rotated.SubjectId);
        return Results.Ok(new SessionDto(accessToken, rotated.RefreshToken, expiresIn));
    }

    // ------------------------------------------------------------------ sign out
    private static async Task<IResult> Logout(RefreshRequest request, SqlDatabase db, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(request.RefreshToken) && request.RefreshToken.Length <= 200)
        {
            await SessionStore.Owner.Revoke(request.RefreshToken, db, ct);
        }

        // Always 204, so the endpoint cannot be used to test whether a token exists.
        return Results.NoContent();
    }
}
