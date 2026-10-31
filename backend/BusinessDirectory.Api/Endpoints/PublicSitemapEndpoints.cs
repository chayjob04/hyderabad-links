using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// What belongs in the public sitemap: every page a search engine should know about, and when it
/// last changed.
///
/// It is its own endpoint rather than a page of search results because a sitemap wants everything at
/// once with no ranking, and because only this view needs to carry a last-modified date.
///
/// Only <c>active</c> listings are included. A draft, a listing waiting for review, a rejected one
/// and a suspended one are all absent, because none of them has a page a visitor could open.
/// </summary>
public static class PublicSitemapEndpoints
{
    /// <summary>
    /// The sitemap protocol's own ceiling is 50,000 URLs per file. Hyderabad Links is far below it;
    /// when it is not, this is the number that says the sitemap has to be split into an index.
    /// </summary>
    public const int MaxUrls = 50_000;

    public sealed record SitemapEntryDto(string Url, DateTimeOffset? LastModified);

    /// <param name="Truncated">
    /// True when the listing cap was reached, so whoever renders the sitemap knows it is now
    /// incomplete and needs splitting rather than silently losing pages.
    /// </param>
    public sealed record SitemapDto(
        IReadOnlyList<SitemapEntryDto> Listings,
        IReadOnlyList<SitemapEntryDto> Localities,
        IReadOnlyList<SitemapEntryDto> Categories,
        bool Truncated);

    public static RouteGroupBuilder MapPublicSitemapEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/sitemap", GetSitemap);
        return group;
    }

    private static async Task<IResult> GetSitemap(SqlDatabase db, CancellationToken ct)
    {
        var listings = new List<SitemapEntryDto>();
        await using (var command = db.CreateCommand(
            /* TOP (@limit) rather than LIMIT, and a CASE rather than GREATEST, which SQL Server
               does not have. published_at is null until a listing first goes live, and the CASE
               keeps the "whichever is later" meaning including that case. */
            @"SELECT TOP (@limit) pcparent.slug, pc.slug, li.slug,
                     CASE WHEN li.published_at IS NULL OR li.updated_at > li.published_at
                          THEN li.updated_at ELSE li.published_at END
              FROM listings li
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              JOIN categories pc ON pc.id = lc.category_id
              JOIN categories pcparent ON pcparent.id = pc.parent_id
              WHERE li.status = 'active'
                /* A listing whose page_meta says noindex is left out. A sitemap entry says the page
                   is worth a crawler's time and a noindex tag says the opposite, so including it
                   would make the two contradict each other. */
                AND NOT EXISTS (
                    SELECT 1 FROM dbo.page_meta m
                    WHERE m.entity_type = 'listing' AND m.entity_id = li.id AND m.noindex = 1)
              ORDER BY li.updated_at DESC"))
        {
            // One over the cap, so a full page tells us there is more rather than guessing.
            command.Parameters.AddWithValue("limit", MaxUrls + 1);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                listings.Add(new SitemapEntryDto(
                    PublicUrl.ForListing(reader.GetString(0), reader.GetString(1), reader.GetString(2))!,
                    reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3)));
            }
        }

        var truncated = listings.Count > MaxUrls;
        if (truncated)
        {
            listings.RemoveAt(listings.Count - 1);
        }

        // An area + category page only exists meaningfully where there is something to show on it,
        // so the pairs come from the live listings themselves rather than from every possible
        // combination of 103 areas and 134 categories, which would be thin pages by the thousand.
        var localities = new List<SitemapEntryDto>();
        await using (var command = db.CreateCommand(
            @"SELECT DISTINCT lo.slug, pc.slug
              FROM listings li
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              JOIN categories pc ON pc.id = lc.category_id
              WHERE li.status = 'active'
              ORDER BY lo.slug, pc.slug"))
        {
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                localities.Add(new SitemapEntryDto(
                    PublicUrl.ForAreaCategory(reader.GetString(0), reader.GetString(1)),
                    null));
            }
        }

        /* Category pages. Both levels are real pages: /food lists its subcategories, /food/cafes
           lists businesses. They used to be /search?category=..., which search engines treat as one
           page with a parameter rather than as a page each. */
        var categories = new List<SitemapEntryDto>();
        await using (var command = db.CreateCommand(
            @"SELECT c.level, p.slug, c.slug
              FROM categories c
              LEFT JOIN categories p ON p.id = c.parent_id
              WHERE c.is_active = 1 AND (c.level = 1 OR p.is_active = 1)
              ORDER BY c.level, c.slug"))
        {
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var path = reader.GetInt16(0) == 1
                    ? PublicUrl.ForTopCategory(reader.GetString(2))
                    : PublicUrl.ForCategory(reader.GetString(1), reader.GetString(2));
                categories.Add(new SitemapEntryDto(path, null));
            }
        }

        return Results.Ok(new SitemapDto(listings, localities, categories, truncated));
    }
}
