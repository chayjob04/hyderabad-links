using System.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Notifications;

/// <summary>The events we notify somebody about. These are the values the V0010 CHECK constraint allows.</summary>
public static class NotificationKinds
{
    public const string EnquiryReceived = "enquiry_received";
    public const string ListingApproved = "listing_approved";
    public const string ListingRejected = "listing_rejected";

    /// <summary>A paid period started or was renewed. Allowed by notifications_kind_check from S0013.</summary>
    public const string SubscriptionActivated = "subscription_activated";
}

/// <summary>
/// Records a notification and then tries to deliver it.
///
/// The order matters and is the whole point of this class. The row is written inside the caller's
/// transaction, alongside the thing that caused it, so a recorded enquiry always has a recorded
/// notification. Delivery happens after the commit, and a failure there only moves the row to
/// 'failed' with the reason: an enquiry that was stored is worth more than an email that went out,
/// so nothing in here is ever allowed to fail the request that triggered it.
///
/// That also means a failure is visible. Without the row, an unconfigured provider or a bounced
/// address would be a silent nothing, and the first person to notice would be an owner wondering
/// why they never hear about their customers.
/// </summary>
public sealed class Notifier(IEmailSender sender, EmailSettings settings, ILogger<Notifier> logger)
{
    /// <summary>How much of a delivery error is kept. Matches the V0010 length constraint.</summary>
    private const int MaxErrorLength = 1000;

    /// <summary>The public site, for links in the templates. Null when not configured.</summary>
    public string? SiteBaseUrl => settings.SiteBaseUrl;

    /// <summary>
    /// Writes the 'pending' row, in the caller's transaction. Returns its id, which the caller hands
    /// back to <see cref="DeliverAsync"/> after committing.
    /// </summary>
    /// <param name="recipient">A normalised address. Validate it with <see cref="EmailAddress"/> first.</param>
    /// <param name="userId">The owner being notified, when they have an account. Null otherwise.</param>
    /// <param name="subjectType">What this is about: "enquiry" or "listing".</param>
    public static async Task<long> RecordPendingEmailAsync(
        SqlConnection conn,
        SqlTransaction tx,
        string kind,
        string recipient,
        long? userId,
        string subjectType,
        long subjectId,
        CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"INSERT INTO notifications (kind, channel, recipient, user_id, subject_type, subject_id)
              OUTPUT inserted.id
              VALUES (@kind, 'email', @recipient, @user, @subject_type, @subject_id)", conn, tx);
        command.Parameters.AddWithValue("kind", kind);
        command.Parameters.AddWithValue("recipient", recipient);
        command.Parameters.Add(new SqlParameter("user", SqlDbType.BigInt) { Value = (object?)userId ?? DBNull.Value });
        command.Parameters.AddWithValue("subject_type", subjectType);
        command.Parameters.AddWithValue("subject_id", subjectId);
        return (long)(await command.ExecuteScalarAsync(ct))!;
    }

    /// <summary>
    /// Sends the message and moves the row to 'sent' or 'failed'. Never throws: by the time this
    /// runs the caller has already committed the work the person actually asked for.
    ///
    /// <paramref name="conn"/> is the caller's own connection, still open after its commit. Using it
    /// keeps this out of the transaction (so the status is not rolled back with anything) without
    /// needing a second connection from the pool.
    /// </summary>
    public async Task DeliverAsync(SqlConnection conn, long notificationId, EmailMessage message, CancellationToken ct)
    {
        try
        {
            await sender.SendAsync(message, ct);
            await MarkAsync(conn, notificationId, sent: true, error: null, ct);
        }
        catch (Exception ex)
        {
            // Only the type and message, trimmed. A provider adapter must never put its API key in
            // either, because this ends up in a database row and in the log line below.
            var reason = Trim($"{ex.GetType().Name}: {ex.Message}");
            logger.LogError(ex, "Notification {NotificationId} could not be delivered.", notificationId);

            try
            {
                await MarkAsync(conn, notificationId, sent: false, reason, ct);
            }
            catch (Exception recordFailure)
            {
                // The database went away between the commit and now. The log is all that is left.
                logger.LogError(recordFailure, "Notification {NotificationId} failed and the failure could not be recorded.", notificationId);
            }
        }
    }

    private static async Task MarkAsync(SqlConnection conn, long notificationId, bool sent, string? error, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"UPDATE notifications
              SET status = @status,
                  attempts = attempts + 1,
                  sent_at = CASE WHEN @status = 'sent' THEN SYSDATETIMEOFFSET() ELSE NULL END,
                  error = @error,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn);
        command.Parameters.AddWithValue("id", notificationId);
        command.Parameters.AddWithValue("status", sent ? "sent" : "failed");
        command.Parameters.Add(new SqlParameter("error", SqlDbType.NVarChar) { Value = (object?)error ?? DBNull.Value });
        await command.ExecuteNonQueryAsync(ct);
    }

    private static string Trim(string reason) =>
        reason.Length <= MaxErrorLength ? reason : reason[..MaxErrorLength];
}
