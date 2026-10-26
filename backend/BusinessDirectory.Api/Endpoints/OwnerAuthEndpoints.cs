using BusinessDirectory.Api.Data;
using System.Data;
using System.Net;
using BusinessDirectory.Api.Auth;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Business-owner login by phone OTP, under /api/v1/auth/owner. Raw parameterised SQL, no ORM.
/// Rate limits live in SQL Server (counted from otp_challenges), so they hold across several API instances.
/// The browser never calls these directly: the Next.js server calls them and keeps the tokens in httpOnly cookies.
/// </summary>
public static class OwnerAuthEndpoints
{
    public sealed record RequestOtpRequest(string? Phone);

    public sealed record VerifyOtpRequest(string? Phone, string? Code);

    public sealed record RefreshRequest(string? RefreshToken);

    public sealed record OtpRequestedDto(int ExpiresInSeconds, int ResendAfterSeconds);

    public sealed record SessionDto(string AccessToken, string RefreshToken, int ExpiresInSeconds);

    private const string InvalidCodeMessage = "The code is invalid or has expired.";

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

        var ip = http.Connection.RemoteIpAddress;

        await using (var check = db.CreateCommand(
            @"SELECT
                (SELECT COUNT_BIG(*) FROM otp_challenges WHERE phone_e164 = @phone AND created_at > DATEADD(hour, -1, SYSDATETIMEOFFSET())),
                -- Was the last code sent within the cooldown? A yes/no answer, which in SQL Server
                -- has to be a CASE producing a bit. No row at all means no, as the COALESCE said.
                CAST(CASE WHEN (SELECT max(created_at) FROM otp_challenges WHERE phone_e164 = @phone)
                             > DATEADD(second, -@cooldown, SYSDATETIMEOFFSET())
                          THEN 1 ELSE 0 END AS bit),
                (SELECT COUNT_BIG(*) FROM otp_challenges WHERE requester_ip = @ip AND created_at > DATEADD(hour, -1, SYSDATETIMEOFFSET()))"))
        {
            check.Parameters.AddWithValue("phone", phone);
            // int, not double: DATEADD takes a whole number of seconds.
            check.Parameters.AddWithValue("cooldown", settings.ResendCooldownSeconds);
            check.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });

            await using var reader = await check.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            var perPhone = reader.GetInt64(0);
            var inCooldown = reader.GetBoolean(1);
            var perIp = reader.GetInt64(2);
            if (inCooldown || perPhone >= settings.MaxOtpPerPhonePerHour || perIp >= settings.MaxOtpPerIpPerHour)
            {
                http.Response.Headers.RetryAfter = settings.ResendCooldownSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
                return Results.Problem("Too many code requests. Please wait a little and try again.", statusCode: StatusCodes.Status429TooManyRequests);
            }
        }

        /* Dummy mode (Auth:DummyOtpEnabled) changes the code's value and nothing else. It is hashed,
           stored, rate-limited and verified by the same lines a real one is, which is why the rest
           of sign-in needs no special case: see AuthSettings.DummyOtpEnabled. */
        var code = settings.DummyOtpEnabled ? AuthSettings.DummyOtpCode : OtpCodes.Generate();
        var hash = OtpCodes.Hash(settings.OtpKey, phone, code);

        /* The challenge is written before the code is sent, because the code must be verifiable the
           instant it arrives — an SMS can reach a phone faster than a second database round trip.
           Its id comes back so that a send which fails can take the row with it; see below. */
        long challengeId;
        await using (var insert = db.CreateCommand(
            @"INSERT INTO otp_challenges (phone_e164, code_hash, expires_at, requester_ip)
              OUTPUT INSERTED.id
              VALUES (@phone, @hash, DATEADD(second, @ttl, SYSDATETIMEOFFSET()), @ip)"))
        {
            insert.Parameters.AddWithValue("phone", phone);
            insert.Parameters.Add(new SqlParameter("hash", SqlDbType.VarBinary) { Value = hash });
            insert.Parameters.AddWithValue("ttl", settings.OtpTtlSeconds);
            insert.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
            challengeId = (long)(await insert.ExecuteScalarAsync(ct))!;
        }

        if (settings.DummyOtpEnabled)
        {
            /* Nothing is sent, so MSG91 is never called and no SMS is paid for. Logged on every
               request, at warning, because a sign-in bypass that leaves no trace is one nobody
               notices was left on. The code itself stays out of the line: it is in configuration
               and in the docs, not in a log (CLAUDE.md). */
            logger.LogWarning(
                "Auth:DummyOtpEnabled is ON. No SMS was sent to {Phone}; the fixed test code will be accepted.",
                Msg91SmsSender.Mask(phone));
        }
        else
        {
            try
            {
                await sms.SendOtpAsync(phone, code, ct);
            }
            catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
            {
                /* Three kinds of failure, one answer. InvalidOperationException is the sender's own
                   refusal (no credentials, or MSG91 rejecting the template); HttpRequestException is
                   MSG91 being unreachable; TaskCanceledException is it timing out. Only the first was
                   caught before, so a provider outage answered 500 and read like a fault in this API.

                   The challenge is deleted, which is the part that matters. A code nobody received must
                   not count against this number's five-an-hour allowance or start its resend cooldown:
                   leaving the rows behind meant that an owner trying to sign in during an MSG91 outage
                   burned their whole allowance on codes that never arrived and was then refused with
                   429 for the rest of the hour. */
                await DeleteUnsentChallenge(db, challengeId, logger, ct);

                logger.LogError(ex, "A login code could not be sent, so the challenge was discarded.");
                return Results.Problem("Login by phone is temporarily unavailable.", statusCode: StatusCodes.Status503ServiceUnavailable);
            }
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

        // Lock the newest usable challenge for this phone so concurrent guesses are counted one at a time.
        long challengeId;
        byte[] storedHash;
        int attempts;
        int maxAttempts;
        await using (var find = new SqlCommand(
            /* The row is locked as it is read, so two requests for the same one queue rather than
               both acting on what they saw. PostgreSQL wrote that as FOR UPDATE after the query;
               SQL Server puts it on the table as a hint. HOLDLOCK keeps it to the end of the
               transaction, which is what FOR UPDATE did. */
            @"SELECT TOP (1) id, code_hash, attempts, max_attempts
              FROM otp_challenges WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE phone_e164 = @phone AND consumed_at IS NULL AND expires_at > SYSDATETIMEOFFSET()
              ORDER BY created_at DESC", conn, tx))
        {
            find.Parameters.AddWithValue("phone", phone);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.Problem(InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
            }
            challengeId = reader.GetInt64(0);
            storedHash = reader.GetFieldValue<byte[]>(1);
            attempts = reader.GetInt16(2);
            maxAttempts = reader.GetInt16(3);
        }

        if (attempts >= maxAttempts)
        {
            return Results.Problem(InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
        }

        // Count the attempt first, and commit it even when the guess is wrong.
        await using (var bump = new SqlCommand("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = @id", conn, tx))
        {
            bump.Parameters.AddWithValue("id", challengeId);
            await bump.ExecuteNonQueryAsync(ct);
        }

        if (!OtpCodes.Verify(settings.OtpKey, phone, request.Code!, storedHash))
        {
            await tx.CommitAsync(ct);
            return Results.Problem(InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
        }

        await using (var consume = new SqlCommand("UPDATE otp_challenges SET consumed_at = SYSDATETIMEOFFSET() WHERE id = @id AND consumed_at IS NULL", conn, tx))
        {
            consume.Parameters.AddWithValue("id", challengeId);
            if (await consume.ExecuteNonQueryAsync(ct) != 1)
            {
                return Results.Problem(InvalidCodeMessage, statusCode: StatusCodes.Status400BadRequest);
            }
        }

        // First successful login creates the account.
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
        await using (var session = new SqlCommand(
            @"INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at, ip, user_agent)
              VALUES (@user, @hash, DATEADD(day, @days, SYSDATETIMEOFFSET()), @ip, @ua)", conn, tx))
        {
            AddSessionParameters(session, userId, refreshToken, settings, http);
            await session.ExecuteNonQueryAsync(ct);
        }

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

        var presentedHash = TokenService.HashRefreshToken(request.RefreshToken);

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        long sessionId;
        long userId;
        Guid familyId;
        bool expired;
        bool alreadyUsed;
        await using (var find = new SqlCommand(
            /* The row is locked as it is read, so two requests for the same one queue rather than
               both acting on what they saw. PostgreSQL wrote that as FOR UPDATE after the query;
               SQL Server puts it on the table as a hint. HOLDLOCK keeps it to the end of the
               transaction, which is what FOR UPDATE did. */
            @"SELECT id, user_id, family_id,
                     CAST(CASE WHEN expires_at <= SYSDATETIMEOFFSET() THEN 1 ELSE 0 END AS bit),
                     CAST(CASE WHEN rotated_at IS NOT NULL OR revoked_at IS NOT NULL THEN 1 ELSE 0 END AS bit)
              FROM user_sessions WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE refresh_token_hash = @hash", conn, tx))
        {
            find.Parameters.Add(new SqlParameter("hash", SqlDbType.VarBinary) { Value = presentedHash });
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.Unauthorized();
            }
            sessionId = reader.GetInt64(0);
            userId = reader.GetInt64(1);
            familyId = reader.GetGuid(2);
            expired = reader.GetBoolean(3);
            alreadyUsed = reader.GetBoolean(4);
        }

        if (alreadyUsed)
        {
            // A token that was already rotated or revoked is being presented again: assume theft and end the whole family.
            await using var revoke = new SqlCommand(
                "UPDATE user_sessions SET revoked_at = SYSDATETIMEOFFSET(), revoked_reason = 'reuse_detected' WHERE family_id = @family AND revoked_at IS NULL", conn, tx);
            revoke.Parameters.AddWithValue("family", familyId);
            await revoke.ExecuteNonQueryAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Unauthorized();
        }

        if (expired)
        {
            return Results.Unauthorized();
        }

        await using (var status = new SqlCommand("SELECT status FROM users WHERE id = @id", conn, tx))
        {
            status.Parameters.AddWithValue("id", userId);
            if ((string?)await status.ExecuteScalarAsync(ct) != "active")
            {
                return Results.Unauthorized();
            }
        }

        await using (var rotate = new SqlCommand("UPDATE user_sessions SET rotated_at = SYSDATETIMEOFFSET() WHERE id = @id", conn, tx))
        {
            rotate.Parameters.AddWithValue("id", sessionId);
            await rotate.ExecuteNonQueryAsync(ct);
        }

        var newRefreshToken = TokenService.NewRefreshToken();
        await using (var insert = new SqlCommand(
            @"INSERT INTO user_sessions (user_id, family_id, refresh_token_hash, expires_at, ip, user_agent)
              VALUES (@user, @family, @hash, DATEADD(day, @days, SYSDATETIMEOFFSET()), @ip, @ua)", conn, tx))
        {
            AddSessionParameters(insert, userId, newRefreshToken, settings, http);
            insert.Parameters.AddWithValue("family", familyId);
            await insert.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);

        var (accessToken, expiresIn) = tokens.CreateAccessToken(userId);
        return Results.Ok(new SessionDto(accessToken, newRefreshToken, expiresIn));
    }

    // ------------------------------------------------------------------ sign out
    private static async Task<IResult> Logout(RefreshRequest request, SqlDatabase db, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(request.RefreshToken) && request.RefreshToken.Length <= 200)
        {
            await using var command = db.CreateCommand(
                @"UPDATE user_sessions SET revoked_at = SYSDATETIMEOFFSET(), revoked_reason = 'logout'
                  WHERE revoked_at IS NULL
                    AND family_id = (SELECT family_id FROM user_sessions WHERE refresh_token_hash = @hash)");
            command.Parameters.Add(new SqlParameter("hash", SqlDbType.VarBinary) { Value = TokenService.HashRefreshToken(request.RefreshToken) });
            await command.ExecuteNonQueryAsync(ct);
        }

        // Always 204, so the endpoint cannot be used to test whether a token exists.
        return Results.NoContent();
    }

    private static void AddSessionParameters(SqlCommand command, long userId, string refreshToken, AuthSettings settings, HttpContext http)
    {
        var userAgent = http.Request.Headers.UserAgent.ToString();
        if (userAgent.Length > 300)
        {
            userAgent = userAgent[..300];
        }

        IPAddress? ip = http.Connection.RemoteIpAddress;
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.Add(new SqlParameter("hash", SqlDbType.VarBinary) { Value = TokenService.HashRefreshToken(refreshToken) });
        command.Parameters.AddWithValue("days", settings.RefreshTokenDays);
        command.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("ua", SqlDbType.NVarChar) { Value = string.IsNullOrEmpty(userAgent) ? DBNull.Value : userAgent });
    }

    /// <summary>
    /// Removes a challenge whose code was never delivered, so it cannot count against the caller's
    /// allowance. Never throws: the request is already being answered with a 503, and failing to
    /// tidy up must not turn that into a 500. The row expires on its own in any case.
    /// </summary>
    private static async Task DeleteUnsentChallenge(
        SqlDatabase db, long challengeId, ILogger logger, CancellationToken ct)
    {
        try
        {
            await using var delete = db.CreateCommand(
                "DELETE FROM otp_challenges WHERE id = @id AND consumed_at IS NULL");
            delete.Parameters.AddWithValue("id", challengeId);
            await delete.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            logger.LogWarning(
                ex,
                "An unsent login challenge could not be discarded; it will expire on its own in a few minutes.");
        }
    }
}