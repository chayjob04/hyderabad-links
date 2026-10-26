using System.Security.Claims;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// The owner's side of a staff alert, under /api/v1/me/listings/{id}/alerts.
///
/// The email is not the delivery mechanism, it is a copy of it. An owner with a bounced address, a
/// full inbox or an over-zealous spam filter still sees every alert here, which is the reason the
/// message is stored in `listing_alerts` rather than only recorded as a notification attempt.
///
/// Ownership is checked the same way as everywhere else in this group: by joining through
/// `business_members` for the caller's own user id. A matching phone number is not proof of
/// ownership, and neither is knowing a listing id.
/// </summary>
public static class OwnerAlertEndpoints
{
    public static RouteGroupBuilder MapOwnerAlertEndpoints(this RouteGroupBuilder listings)
    {
        listings.MapGet("/{id:long}/alerts", List);
        listings.MapPost("/{id:long}/alerts/{alertId:long}/acknowledge", Acknowledge);
        return listings;
    }

    /// <summary>
    /// Whether this user may act on this listing. Returns the connection's answer rather than a
    /// listing, because every caller here only needs the yes or no.
    /// </summary>
    private static async Task<bool> OwnsListing(
        SqlConnection conn, SqlTransaction? tx, long userId, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT TOP (1) 1
              FROM dbo.listings li
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              WHERE li.id = @listing", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("listing", listingId);
        return await command.ExecuteScalarAsync(ct) is not null;
    }

    private static async Task<IResult> List(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        if (!await OwnsListing(conn, null, userId, id, ct))
        {
            // 404 rather than 403: someone who does not own this listing learns nothing about
            // whether it exists.
            return Results.NotFound();
        }

        return Results.Ok(await ListingAlerts.ListForListingAsync(conn, null, id, ct));
    }

    /// <summary>
    /// Marks an alert read. This is the owner saying "I have seen this", not "I have fixed it" —
    /// nothing here changes the listing, and staff can still see what they asked for.
    /// </summary>
    private static async Task<IResult> Acknowledge(
        long id, long alertId, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        if (!await OwnsListing(conn, null, userId, id, ct))
        {
            return Results.NotFound();
        }

        /* The listing id is in the WHERE clause as well as the alert id, so an owner cannot
           acknowledge an alert on somebody else's listing by guessing its number. */
        await using var update = new SqlCommand(
            @"UPDATE dbo.listing_alerts
              SET acknowledged_at = SYSDATETIMEOFFSET()
              WHERE id = @alert AND listing_id = @listing AND acknowledged_at IS NULL", conn);
        update.Parameters.AddWithValue("alert", alertId);
        update.Parameters.AddWithValue("listing", id);
        await update.ExecuteNonQueryAsync(ct);

        // No rows updated means it was already acknowledged, or there is no such alert on this
        // listing. Both leave the caller's intent true, so the button is safe to press twice.
        return Results.NoContent();
    }
}
