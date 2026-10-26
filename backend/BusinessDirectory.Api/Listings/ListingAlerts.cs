using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Notifications;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Listings;

/// <summary>
/// Sending an owner a message asking them to correct their listing, and the rules about what may be
/// sent.
///
/// Shared by the admin and super-admin surfaces because it is the same act either way: the two
/// differ in who is allowed to do it, not in what happens. Keeping one copy is what stops the
/// super-admin route quietly drifting into a version that skips the email or the audit row.
///
/// Why this exists at all: the only thing staff could previously do about a wrong phone number was
/// reject the listing, which takes the business off the site. An alert asks for the fix and leaves
/// the listing up, which is the proportionate answer nearly every time.
///
/// The message is stored in `listing_alerts` and is shown in the owner's dashboard. That is
/// deliberate and is not the same thing as the email: `notifications` records what we *tried to
/// send*, so an unconfigured provider or a bounced address would otherwise lose the message
/// entirely, and the owner would never learn there was anything to fix.
/// </summary>
public static class ListingAlerts
{
    /// <summary>
    /// The reasons an alert can give, which are the values the S0017 CHECK constraint allows. Offered
    /// as a fixed list rather than free text so the same problem is described the same way twice, and
    /// so a typo cannot store a reason no screen has words for.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> Reasons = new Dictionary<string, string>
    {
        ["incorrect_details"] = "Incorrect details",
        ["missing_information"] = "Missing information",
        ["wrong_category"] = "Listed in the wrong category",
        ["photo_problem"] = "A problem with the photos",
        ["policy"] = "Against our listing policy",
        ["other"] = "Something else",
    };

    /// <summary>Long enough to explain a real problem, short enough that it is a message and not a document.</summary>
    public const int MaxMessageLength = 2000;

    /// <summary>
    /// Enough that the owner is told what to change. A one-word alert ("wrong") wastes the only
    /// message the owner will read and invites a reply we have nowhere to receive.
    /// </summary>
    public const int MinMessageLength = 10;

    /// <summary>What was wrong with the request, or null when it is fine.</summary>
    public static Dictionary<string, string[]>? Validate(string? reason, string? message)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(reason) || !Reasons.ContainsKey(reason))
        {
            errors["reason"] = [$"Choose one of: {string.Join(", ", Reasons.Keys)}."];
        }

        var trimmed = message?.Trim() ?? string.Empty;
        if (trimmed.Length < MinMessageLength)
        {
            errors["message"] = [$"Say what needs changing, in at least {MinMessageLength} characters."];
        }
        else if (trimmed.Length > MaxMessageLength)
        {
            errors["message"] = [$"Keep it under {MaxMessageLength} characters."];
        }

        return errors.Count > 0 ? errors : null;
    }

    /// <summary>What an alert looks like once it is stored.</summary>
    public sealed record AlertDto(
        long Id,
        string Reason,
        string ReasonLabel,
        string Message,
        string SentByName,
        DateTimeOffset CreatedAt,
        DateTimeOffset? AcknowledgedAt);

    /// <summary>
    /// Writes the alert, the audit row and the pending notification, all inside the caller's
    /// transaction, and returns what still has to be delivered after it commits.
    ///
    /// The email is deliberately not sent from here. It goes out after the commit, like every other
    /// notification in this project, so a provider outage cannot roll back a message the owner can
    /// already see in their dashboard.
    /// </summary>
    public static async Task<(AlertDto Alert, long? NotificationId, EmailMessage? Email)> SendAsync(
        SqlConnection conn,
        SqlTransaction tx,
        AdminIdentity admin,
        long listingId,
        string listingName,
        string? listingUrl,
        string reason,
        string message,
        string action,
        HttpContext http,
        string? siteBaseUrl,
        CancellationToken ct)
    {
        var trimmed = message.Trim();

        long alertId;
        DateTimeOffset createdAt;
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_alerts (listing_id, admin_user_id, sent_by_name, message, reason)
              OUTPUT INSERTED.id, INSERTED.created_at
              VALUES (@listing, @admin, @sentBy, @message, @reason)", conn, tx))
        {
            insert.Parameters.AddWithValue("listing", listingId);
            insert.Parameters.AddWithValue("admin", admin.Id);
            insert.Parameters.AddWithValue("sentBy", admin.DisplayName);
            insert.Parameters.AddWithValue("message", trimmed);
            insert.Parameters.AddWithValue("reason", reason);

            await using var reader = await insert.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            alertId = reader.GetInt64(0);
            createdAt = reader.GetDateTimeOffset(1);
        }

        /* The reason, but never the message. The audit log is read by staff reviewing each other's
           work, and the message is already stored in full on the alert itself -- copying it here
           would duplicate it into a table with a different retention story for no gain. */
        await AuditLog.WriteAsync(
            conn, tx, admin.Id, action, "listing", listingId.ToString(), http, new { alertId, reason }, ct);

        // No account behind the listing means nobody to email. The alert is still stored, so it is
        // waiting if an owner claims the listing later.
        var owner = await OwnerLookup.ForListing(conn, tx, listingId, ct);
        long? notificationId = null;
        EmailMessage? email = null;
        if (owner is not null)
        {
            notificationId = await Notifier.RecordPendingEmailAsync(
                conn, tx, NotificationKinds.ListingAlert, owner.Email, owner.UserId, "listing", listingId, ct);
            email = EmailTemplates.ListingAlertEmail(
                owner.Email,
                new EmailTemplates.ListingAlertDetails(
                    listingName, listingUrl, Reasons[reason], trimmed, admin.DisplayName),
                siteBaseUrl);
        }

        var dto = new AlertDto(alertId, reason, Reasons[reason], trimmed, admin.DisplayName, createdAt, null);
        return (dto, notificationId, email);
    }

    /// <summary>
    /// Every alert on a listing, newest first. Used by the owner's dashboard and by both staff
    /// surfaces, so staff can see what has already been asked for before asking again.
    /// </summary>
    public static async Task<List<AlertDto>> ListForListingAsync(
        SqlConnection conn, SqlTransaction? tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT a.id, a.reason, a.message, a.sent_by_name, a.created_at, a.acknowledged_at
              FROM dbo.listing_alerts a
              WHERE a.listing_id = @listing
              ORDER BY a.created_at DESC, a.id DESC", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        var alerts = new List<AlertDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var reason = reader.GetString(1);
            alerts.Add(new AlertDto(
                reader.GetInt64(0),
                reason,
                // A reason stored before a label existed for it still reads as something.
                Reasons.TryGetValue(reason, out var label) ? label : reason,
                reader.GetString(2),
                reader.GetString(3),
                reader.GetDateTimeOffset(4),
                reader.IsDBNull(5) ? null : reader.GetDateTimeOffset(5)));
        }

        return alerts;
    }
}
