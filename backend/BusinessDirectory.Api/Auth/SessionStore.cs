using System.Data;
using System.Net;
using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Auth;

/// <summary>
/// Refresh-token sessions for one realm, in one table. There are two instances and no others:
/// <see cref="Owner"/> over <c>user_sessions</c>, and <see cref="Customer"/> over
/// <c>customer_sessions</c>.
///
/// <para>
/// The two realms keep separate tables so that a stolen customer token can never be rotated into an
/// owner session, but the <i>rules</i> must be identical: rotate on every use, and treat the
/// presentation of an already-rotated token as theft and revoke the whole family. Two hand-written
/// copies of that would eventually disagree. This holds one copy and the table names it works on.
/// </para>
/// <para>
/// The table and column names are interpolated into the SQL, which is normally how injection gets
/// in. It cannot here: they come only from the two private constructor calls below, are
/// <c>const</c>-like literals in this file, and nothing from a request reaches them. Every value is
/// still a parameter, as decision D6 requires.
/// </para>
/// </summary>
public sealed class SessionStore
{
    public static readonly SessionStore Owner = new("user_sessions", "user_id", "users");
    public static readonly SessionStore Customer = new("customer_sessions", "customer_id", "customers");

    private readonly string _sessions;
    private readonly string _subjectColumn;
    private readonly string _identities;

    private SessionStore(string sessions, string subjectColumn, string identities)
    {
        _sessions = sessions;
        _subjectColumn = subjectColumn;
        _identities = identities;
    }

    /// <summary>The outcome of presenting a refresh token.</summary>
    public sealed record Rotated(long SubjectId, string RefreshToken);

    /// <summary>Opens the first session of a sign-in, inside the caller's transaction.</summary>
    public async Task Create(
        SqlConnection conn,
        SqlTransaction tx,
        long subjectId,
        string refreshToken,
        AuthSettings settings,
        HttpContext http,
        CancellationToken ct)
    {
        await using var insert = new SqlCommand(
            $@"INSERT INTO {_sessions} ({_subjectColumn}, refresh_token_hash, expires_at, ip, user_agent)
               VALUES (@subject, @hash, DATEADD(day, @days, SYSDATETIMEOFFSET()), @ip, @ua)", conn, tx);
        AddSessionParameters(insert, subjectId, refreshToken, settings, http);
        await insert.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Exchanges a refresh token for a fresh pair, or returns null when it must be refused. Opens
    /// and commits its own transaction, because every branch here is a complete decision.
    /// </summary>
    public async Task<Rotated?> Rotate(
        string refreshToken,
        SqlDatabase db,
        AuthSettings settings,
        HttpContext http,
        CancellationToken ct)
    {
        var presentedHash = TokenService.HashRefreshToken(refreshToken);

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        long sessionId;
        long subjectId;
        Guid familyId;
        bool expired;
        bool alreadyUsed;
        await using (var find = new SqlCommand(
            /* The row is locked as it is read, so two requests for the same one queue rather than
               both acting on what they saw. PostgreSQL wrote that as FOR UPDATE after the query;
               SQL Server puts it on the table as a hint. HOLDLOCK keeps it to the end of the
               transaction, which is what FOR UPDATE did. */
            $@"SELECT id, {_subjectColumn}, family_id,
                      CAST(CASE WHEN expires_at <= SYSDATETIMEOFFSET() THEN 1 ELSE 0 END AS bit),
                      CAST(CASE WHEN rotated_at IS NOT NULL OR revoked_at IS NOT NULL THEN 1 ELSE 0 END AS bit)
               FROM {_sessions} WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
               WHERE refresh_token_hash = @hash", conn, tx))
        {
            find.Parameters.Add(new SqlParameter("hash", SqlDbType.VarBinary) { Value = presentedHash });
            await using var reader = await find.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return null;
            }
            sessionId = reader.GetInt64(0);
            subjectId = reader.GetInt64(1);
            familyId = reader.GetGuid(2);
            expired = reader.GetBoolean(3);
            alreadyUsed = reader.GetBoolean(4);
        }

        if (alreadyUsed)
        {
            // A token that was already rotated or revoked is being presented again: assume theft and end the whole family.
            await using var revoke = new SqlCommand(
                $@"UPDATE {_sessions} SET revoked_at = SYSDATETIMEOFFSET(), revoked_reason = 'reuse_detected'
                   WHERE family_id = @family AND revoked_at IS NULL", conn, tx);
            revoke.Parameters.AddWithValue("family", familyId);
            await revoke.ExecuteNonQueryAsync(ct);
            await tx.CommitAsync(ct);
            return null;
        }

        if (expired)
        {
            return null;
        }

        await using (var status = new SqlCommand($"SELECT status FROM {_identities} WHERE id = @id", conn, tx))
        {
            status.Parameters.AddWithValue("id", subjectId);
            if ((string?)await status.ExecuteScalarAsync(ct) != "active")
            {
                return null;
            }
        }

        await using (var rotate = new SqlCommand($"UPDATE {_sessions} SET rotated_at = SYSDATETIMEOFFSET() WHERE id = @id", conn, tx))
        {
            rotate.Parameters.AddWithValue("id", sessionId);
            await rotate.ExecuteNonQueryAsync(ct);
        }

        var newRefreshToken = TokenService.NewRefreshToken();
        await using (var insert = new SqlCommand(
            $@"INSERT INTO {_sessions} ({_subjectColumn}, family_id, refresh_token_hash, expires_at, ip, user_agent)
               VALUES (@subject, @family, @hash, DATEADD(day, @days, SYSDATETIMEOFFSET()), @ip, @ua)", conn, tx))
        {
            AddSessionParameters(insert, subjectId, newRefreshToken, settings, http);
            insert.Parameters.AddWithValue("family", familyId);
            await insert.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return new Rotated(subjectId, newRefreshToken);
    }

    /// <summary>Ends the whole family the presented token belongs to. Silent about whether it existed.</summary>
    public async Task Revoke(string refreshToken, SqlDatabase db, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            $@"UPDATE {_sessions} SET revoked_at = SYSDATETIMEOFFSET(), revoked_reason = 'logout'
               WHERE revoked_at IS NULL
                 AND family_id = (SELECT family_id FROM {_sessions} WHERE refresh_token_hash = @hash)");
        command.Parameters.Add(new SqlParameter("hash", SqlDbType.VarBinary) { Value = TokenService.HashRefreshToken(refreshToken) });
        await command.ExecuteNonQueryAsync(ct);
    }

    private static void AddSessionParameters(
        SqlCommand command, long subjectId, string refreshToken, AuthSettings settings, HttpContext http)
    {
        var userAgent = http.Request.Headers.UserAgent.ToString();
        if (userAgent.Length > 300)
        {
            userAgent = userAgent[..300];
        }

        IPAddress? ip = http.Connection.RemoteIpAddress;
        command.Parameters.AddWithValue("subject", subjectId);
        command.Parameters.Add(new SqlParameter("hash", SqlDbType.VarBinary) { Value = TokenService.HashRefreshToken(refreshToken) });
        command.Parameters.AddWithValue("days", settings.RefreshTokenDays);
        command.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("ua", SqlDbType.NVarChar) { Value = string.IsNullOrEmpty(userAgent) ? DBNull.Value : userAgent });
    }
}
