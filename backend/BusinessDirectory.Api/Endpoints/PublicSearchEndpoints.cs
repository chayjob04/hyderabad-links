using BusinessDirectory.Api.Data;
using System.Data;
using BusinessDirectory.Api.Listings;
using BusinessDirectory.Api.Media;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Database-backed listing search under /api/v1/public/listings/search.
/// Matching uses SQL Server full-text search over name and description, the
/// hl_similarity function for typo tolerance, and the category_search_terms
/// table so a service word such as "tap repair" finds the right trade.
/// </summary>
public static class PublicSearchEndpoints
{
    public sealed record SearchListingDto(
        string Slug,
        string Name,
        string CitySlug,
        string LocalitySlug,
        string LocalityName,
        string CategorySlug,
        string CategoryName,
        int? DistanceMetres,
        string? AddressLine,
        string PhonePrimary,
        string? PhoneWhatsapp,
        string Url,
        /// <summary>The business's logo, or null when it has not uploaded one. The card falls back to a monogram.</summary>
        string? LogoUrl,
        /// <summary>Its first photo, used as the card thumbnail where there is no logo.</summary>
        string? PhotoUrl);

    public sealed record SearchResultsDto(
        IReadOnlyList<SearchListingDto> Items,
        int Page,
        int PageSize,
        int Total,
        int TotalPages);

    public static RouteGroupBuilder MapPublicSearchEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/listings/search", Search);
        return group;
    }

    // One statement does the filtering, ranking, distance, paging and total count.
    // {0} and {1} are the same ORDER BY twice, chosen from a fixed set below - never built from
    // request text. It is needed in both places: inside the CTE it decides *which* rows the page
    // holds, and on the final SELECT it decides what order they come back in. A CTE's own ordering
    // is not carried through the join below, so leaving the second one out returns the right rows
    // shuffled.
    //
    // The last SELECT starts from a single dummy row and LEFT JOINs the page, so it always returns
    // at least one row. That keeps the total available even when the requested page is past the end
    // (the listing columns are then NULL), which lets a client send the visitor back to page 1.
    /*
     * {0}/{1} are the two ORDER BYs described above. {2} and {3} are the text-matching half of the
     * query, which is present only when something was typed:
     *
     *   {2}  the joins -- two CONTAINSTABLE calls (full-text over name and over description) and the
     *        trigram similarity for typo tolerance
     *   {3}  the relevance expression built from them
     *   {4}  the WHERE clause that keeps only rows one of them matched
     *
     * They are composed rather than written inline because CONTAINSTABLE cannot be given a null or
     * empty condition: with nothing typed there is no full-text search to do, and the joins must not
     * be in the statement at all.
     */
    private const string SearchSqlFormat =
        @"WITH qry AS (
              SELECT CASE WHEN @lat IS NULL THEN NULL
                          ELSE geography::Point(@lat, @lng, 4326) END AS point
          ),
          matches AS (
              SELECT li.slug, li.name, ci.slug AS city_slug,
                     lo.slug AS locality_slug, lo.name AS locality_name,
                     pc.slug AS category_slug, pc.name AS category_name,
                     li.address_line, li.phone_primary, li.phone_whatsapp,
                     -- One logo and one photo per card, from listing_visible_media (S0012) so a
                     -- card can never show a file the listing page itself no longer displays. That
                     -- view applies the plan's current allowance as well as is_hidden, which is
                     -- what makes a lapsed listing's logo disappear from its card at the same
                     -- moment it disappears from its page.
                     (SELECT m.storage_key FROM dbo.listing_visible_media m
                      WHERE m.listing_id = li.id AND m.kind = 'logo'
                      ORDER BY m.sort_order, m.id OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY) AS logo_key,
                     (SELECT m.storage_key FROM dbo.listing_visible_media m
                      WHERE m.listing_id = li.id AND m.kind = 'photo'
                      ORDER BY m.sort_order, m.id OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY) AS photo_key,
                     li.location.STDistance(qry.point) AS distance_metres,
                     {3} AS relevance
              FROM qry
              JOIN listings li ON li.status = 'active'
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              JOIN categories pc ON pc.id = lc.category_id
              {2}
              WHERE (@city IS NULL OR ci.slug = @city)
                -- Proximity window, used by locality landing pages so a thinly covered area
                -- still shows businesses just outside it. Uses the SQL Server spatial index on location.
                AND (@radius IS NULL OR li.location.STDistance(qry.point) <= @radius)
                -- A listing belongs to its own locality and to every locality it serves.
                AND (@locality IS NULL
                     OR lo.slug = @locality
                     OR EXISTS (SELECT 1
                                FROM listing_service_areas sa
                                JOIN localities sl ON sl.id = sa.locality_id
                                WHERE sa.listing_id = li.id AND sl.slug = @locality))
                -- A parent category slug also matches listings filed under its sub-categories.
                AND (@category IS NULL
                     OR EXISTS (SELECT 1
                                FROM listing_categories fc
                                JOIN categories fcat ON fcat.id = fc.category_id
                                LEFT JOIN categories fparent ON fparent.id = fcat.parent_id
                                WHERE fc.listing_id = li.id
                                  AND (fcat.slug = @category OR fparent.slug = @category)))
                {4}
          ),
          page AS (
              SELECT * FROM matches ORDER BY {0} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
          )
          SELECT (SELECT COUNT_BIG(*) FROM matches) AS total,
                 p.slug, p.name, p.city_slug, p.locality_slug, p.locality_name,
                 p.category_slug, p.category_name, p.address_line, p.phone_primary,
                 p.phone_whatsapp, p.distance_metres, p.logo_key, p.photo_key
          FROM (SELECT 1 AS one) AS always_one_row
          LEFT JOIN page p ON 1 = 1
          ORDER BY {1}";

    private static async Task<IResult> Search(
        string? q,
        string? city,
        string? locality,
        string? category,
        double? lat,
        double? lng,
        double? radiusKm,
        string? sort,
        int? page,
        int? pageSize,
        SqlDatabase db,
        IMediaStorage storage,
        CancellationToken ct)
    {
        var query = ListingSearchQuery.TryCreate(q, city, locality, category, lat, lng, radiusKm, sort, page, pageSize, out var error);
        if (query is null)
        {
            return Results.Problem(error, statusCode: StatusCodes.Status400BadRequest);
        }

        // The same ordering for the CTE (bare column names) and for the final SELECT (p.-qualified).
        var (pageOrder, resultOrder) = query.Sort switch
        {
            /* SQL Server has no NULLS LAST: it sorts nulls first ascending and last descending.
               A "is it null" column in front of each one puts them where PostgreSQL put them --
               rows with no distance (no point was given) after the ones that have it. */
            ListingSortOrder.Distance => (
                "CASE WHEN distance_metres IS NULL THEN 1 ELSE 0 END, distance_metres ASC, name ASC",
                "CASE WHEN p.distance_metres IS NULL THEN 1 ELSE 0 END, p.distance_metres ASC, p.name ASC"),
            ListingSortOrder.Name => (
                "name ASC",
                "p.name ASC"),
            _ => (
                "CASE WHEN relevance IS NULL THEN 1 ELSE 0 END, relevance DESC, CASE WHEN distance_metres IS NULL THEN 1 ELSE 0 END, distance_metres ASC, name ASC",
                "CASE WHEN p.relevance IS NULL THEN 1 ELSE 0 END, p.relevance DESC, CASE WHEN p.distance_metres IS NULL THEN 1 ELSE 0 END, p.distance_metres ASC, p.name ASC"),
        };

        /* With nothing typed there is no text matching at all: no full-text joins, a constant
           relevance, and no extra filter. With something typed, all three appear together. */
        var hasText = query.Text is not null;
        var textJoins = hasText
            ? @"LEFT JOIN CONTAINSTABLE(listings, name, @ftText) ftn ON ftn.[KEY] = li.id
              LEFT JOIN CONTAINSTABLE(listings, description, @ftText) ftd ON ftd.[KEY] = li.id
              CROSS APPLY hl_similarity('listing', li.id, @text) sim"
            : string.Empty;

        /* Preserve the previous search weighting: the name counts double the description.
   SQL Server full-text RANK is 0-1000, so it is scaled to sit beside a similarity
   score of 0-1 rather than swamping it. */
        var relevance = hasText
            ? "(ISNULL(ftn.[RANK], 0) * 2 + ISNULL(ftd.[RANK], 0)) / 1000.0 + sim.similarity"
            : "0";

        var textFilter = hasText
            ? @"AND (ftn.[KEY] IS NOT NULL
                     OR ftd.[KEY] IS NOT NULL
                     OR sim.similarity >= 0.3
                     OR EXISTS (SELECT 1
                                FROM listing_categories kc
                                JOIN categories kcat ON kcat.id = kc.category_id
                                LEFT JOIN category_search_terms kt ON kt.category_id = kcat.id
                                CROSS APPLY hl_similarity('category', kcat.id, @text) csim
                                WHERE kc.listing_id = li.id
                                  AND (csim.similarity >= 0.3 OR kt.term = @text)))"
            : string.Empty;

        await using var command = db.CreateCommand(
            string.Format(SearchSqlFormat, pageOrder, resultOrder, textJoins, relevance, textFilter));
        AddText(command, "text", query.Text);
        if (hasText)
        {
            AddText(command, "ftText", FullTextQuery(query.Text!));
        }
        AddText(command, "city", query.CitySlug);
        AddText(command, "locality", query.LocalitySlug);
        AddText(command, "category", query.CategorySlug);
        AddDouble(command, "lat", query.Latitude);
        AddDouble(command, "lng", query.Longitude);
        AddDouble(command, "radius", query.RadiusKm * 1000);
        command.Parameters.AddWithValue("pageSize", query.PageSize);
        command.Parameters.AddWithValue("offset", query.Offset);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var items = new List<SearchListingDto>();
        var total = 0;
        while (await reader.ReadAsync(ct))
        {
            total = (int)reader.GetInt64(0);
            if (reader.IsDBNull(1))
            {
                continue;   // the placeholder row: this page holds no listings
            }

            var slug = reader.GetString(1);
            var citySlug = reader.GetString(3);
            var localitySlug = reader.GetString(4);
            var categorySlug = reader.GetString(6);
            items.Add(new SearchListingDto(
                slug,
                reader.GetString(2),
                citySlug,
                localitySlug,
                reader.GetString(5),
                categorySlug,
                reader.GetString(7),
                reader.IsDBNull(11) ? null : (int)Math.Round(reader.GetDouble(11)),
                reader.IsDBNull(8) ? null : reader.GetString(8),
                reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                $"/{citySlug}/{localitySlug}/{categorySlug}/{slug}",
                reader.IsDBNull(12) ? null : storage.PublicUrl(reader.GetString(12)),
                reader.IsDBNull(13) ? null : storage.PublicUrl(reader.GetString(13))));
        }

        var totalPages = (int)Math.Ceiling(total / (double)query.PageSize);
        return Results.Ok(new SearchResultsDto(items, query.Page, query.PageSize, total, totalPages));
    }

    /// <summary>
    /// Turns what someone typed into a condition CONTAINSTABLE will accept.
    ///
    /// PostgreSQL had websearch_to_tsquery, which took any text at all and made sense of it. SQL
    /// Server has no such thing: a quote or a stray AND in the string is a syntax error rather than
    /// a search for that word. So each word is reduced to letters and digits, quoted, given a
    /// trailing * so "plumb" still finds "plumbing", and the words are joined with OR -- matching
    /// any of them, which is what a directory search should do.
    ///
    /// Returns a condition that matches nothing when the text had no usable word in it, so the
    /// caller never has to special-case that.
    /// </summary>
    public static string FullTextQuery(string text)
    {
        var words = text
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Select(word => new string(word.Where(char.IsLetterOrDigit).ToArray()))
            .Where(word => word.Length > 0)
            .Take(10)   // a sentence pasted into the box should not become a hundred-term query
            .Select(word => $"\"{word}*\"")
            .ToArray();

        return words.Length == 0 ? "\"\"" : string.Join(" OR ", words);
    }

    private static void AddText(SqlCommand command, string name, string? value) =>
        command.Parameters.Add(new SqlParameter(name, SqlDbType.NVarChar) { Value = (object?)value ?? DBNull.Value });

    private static void AddDouble(SqlCommand command, string name, double? value) =>
        command.Parameters.Add(new SqlParameter(name, SqlDbType.Float) { Value = (object?)value ?? DBNull.Value });
}
