using BusinessDirectory.Api.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Listings a signed-in person has saved (V0009), under <c>/api/v1/customer/favourites</c>.
///
/// A favourite is private to the person who saved it: nothing public counts them, and no owner is
/// told who saved their listing. The list is keyed by the slug a visitor already has in the URL
/// rather than by a numeric id, so the public page can save and unsave without first looking an id up.
///
/// A favourite belongs to a *customer*, not to a business owner: `favourites.customer_id`. Saving a
/// business is the customer half of the site, and an owner who wants to save one signs in on the
/// user tab like anybody else.
/// </summary>
public static class FavouriteEndpoints
{
    public sealed record FavouriteDto(
        long ListingId,
        string Name,
        string CategoryName,
        string LocalityName,
        string PhonePrimary,
        string Url,
        string? LogoUrl,
        /// <summary>
        /// False once the listing stops being live. The entry is kept, because the person saved it
        /// and may want to know what happened to it, but it is not presented as somewhere to go.
        /// </summary>
        bool IsAvailable,
        DateTimeOffset SavedAt);

    public static RouteGroupBuilder MapFavouriteEndpoints(this RouteGroupBuilder customer)
    {
        var group = customer.MapGroup("/favourites");
        group.MapGet("", List);
        group.MapPut("/{citySlug}/{localitySlug}/{slug}", Save);
        group.MapDelete("/{citySlug}/{localitySlug}/{slug}", Forget);
        return group;
    }

    private static async Task<IResult> List(
        ClaimsPrincipal principal, SqlDatabase db, Media.IMediaStorage storage, CancellationToken ct)
    {
        if (!CustomerAccess.TryGetCustomerId(principal, out var customerId))
        {
            return Results.Unauthorized();
        }

        await using var command = db.CreateCommand(
            @"SELECT li.id, li.name, pc.name, lo.name, li.phone_primary,
                     ci.slug, lo.slug, pc.slug, li.slug,
                     (SELECT m.storage_key FROM listing_media m
                      WHERE m.listing_id = li.id AND m.kind = 'logo' AND m.is_hidden = 0
                      ORDER BY m.sort_order, m.id OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY),
                     -- A comparison is not a value in SQL Server, so the yes/no answer is a bit.
                     CAST(CASE WHEN li.status = 'active' THEN 1 ELSE 0 END AS bit) AS is_available,
                     f.created_at
              FROM favourites f
              JOIN listings li ON li.id = f.listing_id
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              JOIN categories pc ON pc.id = lc.category_id
              WHERE f.customer_id = @customer
              ORDER BY f.created_at DESC");
        command.Parameters.AddWithValue("customer", customerId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var items = new List<FavouriteDto>();
        while (await reader.ReadAsync(ct))
        {
            items.Add(new FavouriteDto(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                $"/{reader.GetString(5)}/{reader.GetString(6)}/{reader.GetString(7)}/{reader.GetString(8)}",
                reader.IsDBNull(9) ? null : storage.PublicUrl(reader.GetString(9)),
                reader.GetBoolean(10),
                reader.GetFieldValue<DateTimeOffset>(11)));
        }
        return Results.Ok(items);
    }

    /// <summary>
    /// Saves a listing. PUT, not POST: saving one that is already saved is the same favourite, which
    /// the unique index enforces, and the answer is the same either way.
    /// </summary>
    private static async Task<IResult> Save(
        string citySlug, string localitySlug, string slug, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!CustomerAccess.TryGetCustomerId(principal, out var customerId))
        {
            return Results.Unauthorized();
        }

        // Only a live listing can be saved: a draft or a suspended one has no page to come back to.
        await using var command = db.CreateCommand(
            /* ON CONFLICT DO NOTHING becomes "insert only what is not already there". The primary
               index still has the last word if two requests arrive together: one of them inserts and
               the other's NOT EXISTS was true a moment too early, which surfaces as a duplicate-key
               error -- and saving something already saved is a no-op either way, so the caller is
               told the same thing. */
            @"INSERT INTO favourites (customer_id, listing_id)
              OUTPUT inserted.listing_id
              SELECT @customer, li.id
              FROM listings li
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              WHERE ci.slug = @city AND lo.slug = @locality AND li.slug = @slug AND li.status = 'active'
                AND NOT EXISTS (SELECT 1 FROM favourites f
                                WHERE f.customer_id = @customer AND f.listing_id = li.id)");
        command.Parameters.AddWithValue("customer", customerId);
        command.Parameters.AddWithValue("city", citySlug);
        command.Parameters.AddWithValue("locality", localitySlug);
        command.Parameters.AddWithValue("slug", slug);

        if (await command.ExecuteScalarAsync(ct) is not null)
        {
            return Results.NoContent();
        }

        // Nothing was inserted: either it was already saved, or there is no such live listing. The
        // second query tells them apart, so a visitor is not told "not found" about their own
        // favourite.
        await using var exists = db.CreateCommand(
            @"SELECT 1
              FROM favourites f
              JOIN listings li ON li.id = f.listing_id
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              WHERE f.customer_id = @customer AND ci.slug = @city AND lo.slug = @locality AND li.slug = @slug");
        exists.Parameters.AddWithValue("customer", customerId);
        exists.Parameters.AddWithValue("city", citySlug);
        exists.Parameters.AddWithValue("locality", localitySlug);
        exists.Parameters.AddWithValue("slug", slug);

        return await exists.ExecuteScalarAsync(ct) is not null ? Results.NoContent() : Results.NotFound();
    }

    private static async Task<IResult> Forget(
        string citySlug, string localitySlug, string slug, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!CustomerAccess.TryGetCustomerId(principal, out var customerId))
        {
            return Results.Unauthorized();
        }

        // Unsaving something that is not saved is already the state the caller asked for, so this
        // answers 204 either way rather than 404.
        await using var command = db.CreateCommand(
            /* PostgreSQL's DELETE ... USING, as SQL Server writes it: the alias to delete from
               goes after DELETE and the joins hang off FROM. */
            @"DELETE f
              FROM favourites f
              JOIN listings li ON li.id = f.listing_id
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              WHERE f.customer_id = @customer
                AND ci.slug = @city AND lo.slug = @locality AND li.slug = @slug");
        command.Parameters.AddWithValue("customer", customerId);
        command.Parameters.AddWithValue("city", citySlug);
        command.Parameters.AddWithValue("locality", localitySlug);
        command.Parameters.AddWithValue("slug", slug);
        await command.ExecuteNonQueryAsync(ct);

        return Results.NoContent();
    }
}
