using System.Data;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Auth;

/// <summary>
/// The phone-OTP mechanics shared by the two public sign-ins: business owners
/// (<c>/api/v1/auth/owner</c>) and customers (<c>/api/v1/auth/customer</c>).
///
/// It lives here because there are two callers and the rules must not drift apart. Rate limits, the
/// resend cooldown, the attempt counter and the one-use rule are security behaviour; two copies of
/// them would eventually disagree, and the weaker copy would be the one an attacker used.
///
/// <para>
/// <b>The limits are counted across both purposes on purpose.</b> They are keyed on the phone
/// number and the requester's IP, not on which flow asked, so adding a second sign-in does not hand
/// anybody a second allowance against the same number. Somebody who genuinely signs in to both
/// spends two of their five an hour.
/// </para>
/// <para>
/// <b>Redeeming is keyed on the purpose.</b> A code minted for the customer flow cannot be used to
/// open an owner session, and the other way round, because the lookup that finds the challenge
/// matches on <c>purpose</c> as well as on the phone number.
/// </para>
/// <para>
/// MSG91 is untouched by any of this: the code is generated, hashed and stored exactly as before and
/// handed to <see cref="ISmsSender"/>, whichever flow asked for it.
/// </para>
/// </summary>
public static class OtpFlow
{
    public const string OwnerPurpose = "owner_login";
    public const string CustomerPurpose = "customer_login";

    /// <summary>What happened to a presented code, and what the caller must do about it.</summary>
    public enum CodeOutcome
    {
        /// <summary>The code was right and has been consumed. Carry on inside the transaction.</summary>
        Ok,

        /// <summary>Refuse. Nothing worth keeping was written, so the transaction can roll back.</summary>
        Rejected,

        /// <summary>
        /// Refuse, but commit first: the guess was wrong and the attempt counter must survive, or
        /// an attacker gets unlimited tries by rolling each one back.
        /// </summary>
        RejectedAfterAttempt,
    }

    /// <summary>
    /// Sends a code, or returns the response that refuses to. Null means it was sent (or, in dummy
    /// mode, deliberately not sent) and the caller should answer with <see cref="Requested"/>.
    /// </summary>
    public static async Task<IResult?> SendCode(
        string purpose,
        string phone,
        HttpContext http,
        SqlDatabase db,
        AuthSettings settings,
        ISmsSender sms,
        ILogger logger,
        CancellationToken ct)
    {
        var ip = http.Connection.RemoteIpAddress;

        await using (var check = db.CreateCommand(
            /* Deliberately not filtered by purpose: see the class comment. The allowance belongs to
               the phone number and the IP, not to one of the two sign-ins. */
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
            @"INSERT INTO otp_challenges (phone_e164, purpose, code_hash, expires_at, requester_ip)
              OUTPUT INSERTED.id
              VALUES (@phone, @purpose, @hash, DATEADD(second, @ttl, SYSDATETIMEOFFSET()), @ip)"))
        {
            insert.Parameters.AddWithValue("phone", phone);
            insert.Parameters.AddWithValue("purpose", purpose);
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
            return null;
        }

        try
        {
            await sms.SendOtpAsync(phone, code, ct);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            /* Three kinds of failure, one answer. InvalidOperationException is the sender's own
               refusal (no credentials, or MSG91 rejecting the template); HttpRequestException is
               MSG91 being unreachable; TaskCanceledException is it timing out.

               The challenge is deleted, which is the part that matters. A code nobody received must
               not count against this number's five-an-hour allowance or start its resend cooldown:
               leaving the rows behind meant that somebody trying to sign in during an MSG91 outage
               burned their whole allowance on codes that never arrived and was then refused with
               429 for the rest of the hour. */
            await DeleteUnsentChallenge(db, challengeId, logger, ct);

            logger.LogError(ex, "A login code could not be sent, so the challenge was discarded.");
            return Results.Problem("Login by phone is temporarily unavailable.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return null;
    }

    /// <summary>
    /// Finds the newest usable challenge for this phone <i>and purpose</i>, counts the attempt, and
    /// consumes it when the code is right. Runs inside the caller's transaction so that the attempt
    /// counter and the session it leads to are decided together.
    /// </summary>
    public static async Task<CodeOutcome> ConsumeCode(
        string purpose,
        string phone,
        string code,
        SqlConnection conn,
        SqlTransaction tx,
        AuthSettings settings,
        CancellationToken ct)
    {
        // Lock the newest usable challenge for this phone so concurrent guesses are counted one at a time.
        long challengeId;
        byte[] storedHash;
        int attempts;
        int maxAttempts;
        await using (var find = new SqlCommand(
            /* The row is locked as it is read, so two requests for the same one queue rather than
               both acting on what they saw. PostgreSQL wrote that as FOR UPDATE after the query;
               SQL Server puts it on the table as a hint. HOLDLOCK keeps it to the end of the
               transaction, which is what FOR UPDATE did.

               `purpose` is in the predicate, not just in the insert: that is what stops a code
               minted for one sign-in opening a session on the other. */
            @"SELECT TOP (1) id, code_hash, attempts, max_attempts
              FROM otp_challenges WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
              WHERE phone_e164 = @phone AND purpose = @purpose
                AND consumed_at IS NULL AND expires_at > SYSDATETIMEOFFSET()
              ORDER BY created_at DESC", conn, tx))
        {
            find.Parameters.AddWithValue("phone", phone);
            find.Parameters.AddWithValue("purpose", purpose);
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return CodeOutcome.Rejected;
            }
            challengeId = reader.GetInt64(0);
            storedHash = reader.GetFieldValue<byte[]>(1);
            attempts = reader.GetInt16(2);
            maxAttempts = reader.GetInt16(3);
        }

        if (attempts >= maxAttempts)
        {
            return CodeOutcome.Rejected;
        }

        // Count the attempt first, and commit it even when the guess is wrong.
        await using (var bump = new SqlCommand("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = @id", conn, tx))
        {
            bump.Parameters.AddWithValue("id", challengeId);
            await bump.ExecuteNonQueryAsync(ct);
        }

        if (!OtpCodes.Verify(settings.OtpKey, phone, code, storedHash))
        {
            return CodeOutcome.RejectedAfterAttempt;
        }

        await using (var consume = new SqlCommand(
            "UPDATE otp_challenges SET consumed_at = SYSDATETIMEOFFSET() WHERE id = @id AND consumed_at IS NULL", conn, tx))
        {
            consume.Parameters.AddWithValue("id", challengeId);
            if (await consume.ExecuteNonQueryAsync(ct) != 1)
            {
                return CodeOutcome.Rejected;
            }
        }

        return CodeOutcome.Ok;
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
