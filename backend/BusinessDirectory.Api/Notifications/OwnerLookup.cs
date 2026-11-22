using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Notifications;

/// <summary>Who to notify, and their account. Only produced when there is an address worth trying.</summary>
public sealed record OwnerToNotify(long UserId, string Email);

/// <summary>
/// Finds the person behind a listing, for notifying them.
///
/// Both the enquiry endpoint and listing moderation need the same answer, so the query lives here
/// once. There are three honest ways to have no answer, and all of them return null: the listing is
/// unclaimed and has no member at all, the owner never gave an email address, or what is stored is
/// not something we would send to. None of those is an error — plenty of owners signed in by phone
/// and never typed an email — so the caller simply records no notification.
/// </summary>
public static class OwnerLookup
{
    /// <summary>
    /// The owner of the listing's business, preferring the longest-standing one when a business has
    /// several members. 'manager' members are not notified: this is the business's own mail, and the
    /// owner is who the account belongs to.
    /// </summary>
    public static async Task<OwnerToNotify?> ForListing(
        SqlConnection conn,
        SqlTransaction? tx,
        long listingId,
        CancellationToken ct)
    {
        await using var command = new SqlCommand(
            // TOP (1) rather than LIMIT 1: SQL Server puts the row cap at the front of the SELECT.
            @"SELECT TOP (1) u.id, u.email
              FROM dbo.listings li
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.role = 'owner'
              JOIN dbo.users u ON u.id = bm.user_id
              WHERE li.id = @listing AND u.email IS NOT NULL
              ORDER BY bm.created_at, u.id", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        // The column allows anything; validate before we hand it to a provider, and before it goes
        // into the notifications table, whose CHECK constraint would otherwise refuse the insert and
        // fail the very request we promised not to fail.
        return EmailAddress.TryNormalize(reader.GetString(1), out var address)
            ? new OwnerToNotify(reader.GetInt64(0), address)
            : null;
    }
}
