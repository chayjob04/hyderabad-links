using System.Security.Claims;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// An owner's opening hours, under /api/v1/me/listings/{id}/hours.
///
/// The whole week is sent at once and replaces what was there. That is deliberate: hours are
/// edited as a week, not a row at a time, and the rules that matter — no overlaps, at most one
/// overnight interval per day — can only be checked against the whole day. A per-row API would let
/// a caller build an invalid week one valid request at a time.
///
/// Free as well as paid. Opening hours are for the visitor, who is not the one paying, and a
/// directory that cannot say when a shop opens is less useful to everyone.
/// </summary>
public static class OwnerOpeningHoursEndpoints
{
    public sealed record IntervalDto(int DayOfWeek, string Opens, string Closes);

    public sealed record WeekDto(IReadOnlyList<IntervalDto> Intervals);

    public static RouteGroupBuilder MapOwnerOpeningHoursEndpoints(this RouteGroupBuilder listings)
    {
        listings.MapGet("/{id:long}/hours", Get);
        listings.MapPut("/{id:long}/hours", Replace);
        return listings;
    }

    /// <summary>
    /// Reads the week. Returns an empty list for a listing with no hours set, which is different
    /// from "closed all week" only in the sense that nothing is displayed.
    /// </summary>
    private static async Task<IResult> Get(
        long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        if (!await OwnsListing(conn, null, userId, id, ct))
        {
            // 404, not 403: someone who does not own this listing learns nothing about it.
            return Results.NotFound();
        }

        return Results.Ok(new WeekDto(await ReadAsync(conn, null, id, ct)));
    }

    /// <summary>
    /// Replaces the week in one transaction. The delete and the insert are together, so a failed
    /// insert cannot leave a business with no hours at all — which would read to a visitor as
    /// "permanently closed" rather than as an error.
    /// </summary>
    private static async Task<IResult> Replace(
        long id, WeekDto request, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        var parsed = new List<OpeningHours.Interval>();
        foreach (var dto in request.Intervals ?? [])
        {
            if (!TimeOnly.TryParse(dto.Opens, out var opens) || !TimeOnly.TryParse(dto.Closes, out var closes))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["hours"] = ["Times must look like 09:00."],
                });
            }

            // Seconds are dropped: the column is time(0) and nobody opens a shop at 09:00:30.
            parsed.Add(new OpeningHours.Interval(
                dto.DayOfWeek,
                new TimeOnly(opens.Hour, opens.Minute),
                new TimeOnly(closes.Hour, closes.Minute)));
        }

        if (OpeningHours.Validate(parsed) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        if (!await OwnsListing(conn, tx, userId, id, ct))
        {
            return Results.NotFound();
        }

        await using (var clear = new SqlCommand(
            "DELETE FROM dbo.listing_opening_hours WHERE listing_id = @listing", conn, tx))
        {
            clear.Parameters.AddWithValue("listing", id);
            await clear.ExecuteNonQueryAsync(ct);
        }

        foreach (var interval in parsed)
        {
            await using var insert = new SqlCommand(
                @"INSERT INTO dbo.listing_opening_hours (listing_id, day_of_week, opens_at, closes_at)
                  VALUES (@listing, @day, @opens, @closes)", conn, tx);
            insert.Parameters.AddWithValue("listing", id);
            insert.Parameters.AddWithValue("day", interval.DayOfWeek);
            insert.Parameters.AddWithValue("opens", interval.Opens.ToTimeSpan());
            insert.Parameters.AddWithValue("closes", interval.Closes.ToTimeSpan());
            await insert.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);

        await using var after = await db.OpenConnectionAsync(ct);
        return Results.Ok(new WeekDto(await ReadAsync(after, null, id, ct)));
    }

    /// <summary>The week, in day and time order, as the display expects it.</summary>
    public static async Task<List<IntervalDto>> ReadAsync(
        SqlConnection conn, SqlTransaction? tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT day_of_week, opens_at, closes_at
              FROM dbo.listing_opening_hours
              WHERE listing_id = @listing
              ORDER BY day_of_week, opens_at", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        var week = new List<IntervalDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var opens = TimeOnly.FromTimeSpan(reader.GetTimeSpan(1));
            var closes = TimeOnly.FromTimeSpan(reader.GetTimeSpan(2));
            week.Add(new IntervalDto(reader.GetByte(0), opens.ToString("HH:mm"), closes.ToString("HH:mm")));
        }

        return week;
    }

    /// <summary>
    /// Ownership through business_members, the same join every owner route uses. Knowing a listing
    /// id is not proof of anything.
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
}
