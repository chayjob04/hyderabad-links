using System.Security.Claims;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// What a business offers, the languages it speaks and what it has on site, under
/// /api/v1/me/listings/{id}/attributes.
///
/// One set of routes for all three lists, because they are one table with a kind (S0024). The
/// original had three of everything; this is the same product with a third of the surface.
///
/// Free on every plan. These are what a visitor reads to decide whether to call, so putting them
/// behind the paid tier would charge the business for something that mostly benefits the person
/// looking for it — the same reasoning that kept opening hours free.
/// </summary>
public static class OwnerAttributeEndpoints
{
    public sealed record AttributeRequest(string? Kind, string? Label);

    public sealed record AttributesDto(
        IReadOnlyList<ListingAttributes.AttributeDto> Items,
        IReadOnlyDictionary<string, string> Kinds,
        IReadOnlyDictionary<string, string[]> Suggestions,
        int MaxPerKind);

    public static RouteGroupBuilder MapOwnerAttributeEndpoints(this RouteGroupBuilder listings)
    {
        listings.MapGet("/{id:long}/attributes", List);
        listings.MapPost("/{id:long}/attributes", Add);
        listings.MapDelete("/{id:long}/attributes/{attributeId:long}", Remove);
        return listings;
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
            // 404, not 403: a stranger learns nothing about whether this listing exists.
            return Results.NotFound();
        }

        return Results.Ok(new AttributesDto(
            await ReadAsync(conn, null, id, ct),
            ListingAttributes.Kinds,
            ListingAttributes.Suggestions,
            ListingAttributes.MaxPerKind));
    }

    private static async Task<IResult> Add(
        long id, AttributeRequest request, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        if (ListingAttributes.Validate(request.Kind, request.Label) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        var kind = request.Kind!;
        var label = request.Label!.Trim();

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        if (!await OwnsListing(conn, tx, userId, id, ct))
        {
            return Results.NotFound();
        }

        /* Counted inside the transaction with the listing locked, the same way media and FAQs are,
           so two tabs cannot both take the last slot. */
        await using (var count = new SqlCommand(
            @"SELECT COUNT_BIG(*) FROM dbo.listing_attributes
              WHERE listing_id = @listing AND kind = @kind", conn, tx))
        {
            count.Parameters.AddWithValue("listing", id);
            count.Parameters.AddWithValue("kind", kind);
            if ((long)(await count.ExecuteScalarAsync(ct))! >= ListingAttributes.MaxPerKind)
            {
                return Results.Problem(
                    $"You can list {ListingAttributes.MaxPerKind}. Remove one first.",
                    statusCode: StatusCodes.Status409Conflict);
            }
        }

        /* The same label twice is a double-click, not a second fact. The unique index refuses it
           anyway; this turns that into a sentence rather than a 500. */
        await using (var exists = new SqlCommand(
            @"SELECT TOP (1) 1 FROM dbo.listing_attributes
              WHERE listing_id = @listing AND kind = @kind AND label = @label", conn, tx))
        {
            exists.Parameters.AddWithValue("listing", id);
            exists.Parameters.AddWithValue("kind", kind);
            exists.Parameters.AddWithValue("label", label);
            if (await exists.ExecuteScalarAsync(ct) is not null)
            {
                return Results.Problem(
                    $"“{label}” is already on the list.",
                    statusCode: StatusCodes.Status409Conflict);
            }
        }

        long newId;
        int sortOrder;
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_attributes (listing_id, kind, label, sort_order)
              OUTPUT INSERTED.id, INSERTED.sort_order
              VALUES (@listing, @kind, @label,
                      (SELECT ISNULL(MAX(sort_order), -1) + 1 FROM dbo.listing_attributes
                       WHERE listing_id = @listing AND kind = @kind))", conn, tx))
        {
            insert.Parameters.AddWithValue("listing", id);
            insert.Parameters.AddWithValue("kind", kind);
            insert.Parameters.AddWithValue("label", label);

            await using var reader = await insert.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            newId = reader.GetInt64(0);
            sortOrder = reader.GetInt32(1);
        }

        await tx.CommitAsync(ct);
        return Results.Created(
            $"/api/v1/me/listings/{id}/attributes/{newId}",
            new ListingAttributes.AttributeDto(newId, kind, label, sortOrder));
    }

    private static async Task<IResult> Remove(
        long id, long attributeId, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
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

        /* The listing id is in the WHERE clause as well as the row id, so an owner cannot remove a
           label from somebody else's listing by guessing its number. */
        await using var command = new SqlCommand(
            "DELETE FROM dbo.listing_attributes WHERE id = @row AND listing_id = @listing", conn);
        command.Parameters.AddWithValue("row", attributeId);
        command.Parameters.AddWithValue("listing", id);
        await command.ExecuteNonQueryAsync(ct);

        // Already gone is the caller's intent either way, so the button is safe to press twice.
        return Results.NoContent();
    }

    /// <summary>Every label on a listing, grouped in display order by the caller.</summary>
    public static async Task<List<ListingAttributes.AttributeDto>> ReadAsync(
        SqlConnection conn, SqlTransaction? tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT id, kind, label, sort_order
              FROM dbo.listing_attributes
              WHERE listing_id = @listing
              ORDER BY kind, sort_order, id", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        var items = new List<ListingAttributes.AttributeDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new ListingAttributes.AttributeDto(
                reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3)));
        }

        return items;
    }

    private static async Task<bool> OwnsListing(
        SqlConnection conn, SqlTransaction? tx, long userId, long listingId, CancellationToken ct)
    {
        var lockHint = tx is null ? string.Empty : " WITH (UPDLOCK, ROWLOCK)";
        await using var command = new SqlCommand(
            $@"SELECT TOP (1) 1
               FROM dbo.listings li{lockHint}
               JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
               WHERE li.id = @listing", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("listing", listingId);
        return await command.ExecuteScalarAsync(ct) is not null;
    }
}
