using System.Data;
using System.Net;
using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Auth;

/// <summary>
/// Writes one row to the append-only audit log, in the caller's own transaction so a change can
/// never be committed without its record.
///
/// AdminListingEndpoints and SuperAdminEndpoints each grew a private copy of this before there was
/// a second entity type to record. The taxonomy and super-admin listing surfaces made that four
/// copies, so the shared one lives here. `details` is caller-supplied and must carry no secrets.
/// </summary>
public static class AuditLog
{
    public static async Task WriteAsync(
        SqlConnection conn,
        SqlTransaction? tx,
        long adminId,
        string action,
        string entityType,
        string entityId,
        HttpContext http,
        object details,
        CancellationToken ct)
    {
        IPAddress? ip = http.Connection.RemoteIpAddress;
        await using var command = new SqlCommand(
            @"INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, details, ip)
              VALUES ('admin', @admin, @action, @entityType, @entity, @details, @ip)", conn, tx);
        command.Parameters.AddWithValue("admin", adminId);
        command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("entityType", entityType);
        command.Parameters.AddWithValue("entity", entityId);
        command.Parameters.Add(new SqlParameter("details", SqlDbType.NVarChar) { Value = JsonSerializer.Serialize(details) });
        command.Parameters.Add(new SqlParameter("ip", SqlDbType.VarChar) { Value = (object?)ip?.ToString() ?? DBNull.Value });
        await command.ExecuteNonQueryAsync(ct);
    }
}
