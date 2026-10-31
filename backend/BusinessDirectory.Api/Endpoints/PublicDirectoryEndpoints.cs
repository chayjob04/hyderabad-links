using BusinessDirectory.Api.Data;
using System.Data;
using BusinessDirectory.Api.Listings;
using BusinessDirectory.Api.Media;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>Read-only public directory endpoints under /api/v1/public. Raw parameterised SQL, no ORM.</summary>
public static class PublicDirectoryEndpoints
{
    public sealed record CityDto(string Slug, string Name, string State);

    public sealed record LocalityDto(string Slug, string Name, double Latitude, double Longitude);

    /// <summary>
    /// One locality suggestion. The city name and state come along so similarly named places can be
    /// told apart once there is a second city.
    /// </summary>
    public sealed record LocalitySuggestionDto(string Slug, string Name, string CityName, string State);

    /// <summary>
    /// The known locality closest to a point, with how far away it is, so the caller can say when
    /// the nearest area we know about is not really where the visitor is standing.
    /// </summary>
    public sealed record NearestLocalityDto(string Slug, string Name, string CityName, string State, int DistanceMetres);

    public sealed record SubCategoryDto(string Slug, string Name, string[] SearchTerms);

    public sealed record CategoryDto(string Slug, string Name, List<SubCategoryDto> Children);

    public sealed record NearbyListingDto(
        string Slug,
        string Name,
        string CitySlug,
        string LocalitySlug,
        string LocalityName,
        string CategorySlug,
        string CategoryName,
        int DistanceMetres,
        string? AddressLine,
        string PhonePrimary,
        string? PhoneWhatsapp,
        string Url);

    /// <summary>
    /// One file on a public listing page. Hidden media (over the plan's allowance after a downgrade,
    /// decision D10) is left out entirely, so the public response cannot leak what is not on display.
    /// </summary>
    public sealed record PublicMediaDto(string Kind, string Url, int? Width, int? Height);

    public sealed record ListingDetailDto(
        string Slug,
        string Name,
        string? Description,
        string? AddressLine,
        string? Pincode,
        string PhonePrimary,
        string? PhoneWhatsapp,
        string? WebsiteUrl,
        double Latitude,
        double Longitude,
        string CitySlug,
        string CityName,
        string LocalitySlug,
        string LocalityName,
        string CategorySlug,
        string CategoryName,
        string Url,
        List<PublicMediaDto> Media,
        /// <summary>
        /// True only while a paid period is actually running. Read from listing_entitlements, which
        /// compares expires_at against the clock, so a lapsed listing stops showing the badge on the
        /// next request rather than waiting for a job to notice.
        /// </summary>
        bool IsVerified,
        /// <summary>
        /// The business's own website and social links. Empty on a free listing, because the
        /// allowance is part of the paid plan -- and empty again once that plan lapses, since the
        /// query below is gated on the same entitlement that drives the badge.
        /// </summary>
        List<PublicLinkDto> Links,

        /// <summary>
        /// The week's opening hours, in day order, and whether the business is open at this moment.
        /// Free as well as paid: this is for the visitor, who is not the one paying.
        /// </summary>
        List<OpeningHoursDto> OpeningHours,
        OpenStatusDto? OpenStatus,

        /// <summary>
        /// FAQs and content sections the plan allows right now. Read through
        /// listing_visible_faqs and listing_visible_content, so anything over a lapsed plan's
        /// allowance disappears here while staying in the database (D10).
        /// </summary>
        List<PublicFaqDto> Faqs,
        List<PublicContentDto> ContentSections);

    /// <param name="DayOfWeek">0 = Monday … 6 = Sunday.</param>
    public sealed record OpeningHoursDto(int DayOfWeek, string DayName, string Opens, string Closes);

    /// <param name="OpensAt">When it next opens, if closed now. Null when it is open.</param>
    public sealed record OpenStatusDto(bool IsOpenNow, string? ClosesAt, string? OpensAt, string? OpensDay);

    public sealed record PublicFaqDto(string Question, string Answer);

    public sealed record PublicContentDto(string Heading, string Body);

    /// <param name="Url">Always http or https: enforced on the way in by the API and again by
    /// listing_links_url_shape, so this can be put in an href without further checking.</param>
    public sealed record PublicLinkDto(string LinkType, string Label, string Url);

    public static RouteGroupBuilder MapPublicDirectoryEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/cities", GetCities);
        group.MapGet("/cities/{citySlug}/localities", GetLocalities);
        group.MapGet("/localities/search", SearchLocalities);
        group.MapGet("/localities/nearest", GetNearestLocality);
        group.MapGet("/categories", GetCategories);
        group.MapGet("/listings/nearby", GetNearby);
        group.MapGet("/listings/{parentCategorySlug}/{categorySlug}/{slug}", GetListing);
        return group;
    }

    private static async Task<IResult> GetCities(SqlDatabase db, CancellationToken ct)
    {
        await using var command = db.CreateCommand("SELECT slug, name, state FROM cities WHERE is_active = 1 ORDER BY name");
        await using var reader = await command.ExecuteReaderAsync(ct);
        var cities = new List<CityDto>();
        while (await reader.ReadAsync(ct))
        {
            cities.Add(new CityDto(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
        }
        return Results.Ok(cities);
    }

    private static async Task<IResult> GetLocalities(string citySlug, SqlDatabase db, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            @"SELECT l.slug, l.name, l.center.Lat, l.center.Long
              FROM localities l
              JOIN cities c ON c.id = l.city_id
              WHERE c.slug = @city AND c.is_active = 1 AND l.is_active = 1
              ORDER BY l.name");
        command.Parameters.AddWithValue("city", citySlug);
        await using var reader = await command.ExecuteReaderAsync(ct);
        var localities = new List<LocalityDto>();
        while (await reader.ReadAsync(ct))
        {
            localities.Add(new LocalityDto(reader.GetString(0), reader.GetString(1), reader.GetDouble(2), reader.GetDouble(3)));
        }
        return localities.Count == 0 ? Results.NotFound() : Results.Ok(localities);
    }

    /// <summary>
    /// Partial, case-insensitive locality lookup for the location autocomplete on the websites.
    ///
    /// The ranking is deliberate: names beginning with what was typed come first ("gachi" ->
    /// Gachibowli), then names containing it anywhere ("colony" -> KPHB Colony), then trigram
    /// similarity so a misspelling still lands ("patan" -> Patancheru).
    ///
    /// The similarity comes from stored trigrams (decision D42, migration S0008),
/// using the threshold of 0.3 retained from the previous PostgreSQL implementation.
/// This preserves the previously verified behaviour for locality suggestions.
    /// </summary>
    private static async Task<IResult> SearchLocalities(
        string? q,
        string? city,
        int? limit,
        SqlDatabase db,
        CancellationToken ct)
    {
        var query = LocalitySearchQuery.TryCreate(q, city, limit, out var error);
        if (query is null)
        {
            return Results.Problem(error, statusCode: StatusCodes.Status400BadRequest);
        }

        await using var command = db.CreateCommand(
            @"SELECT TOP (@max) l.slug, l.name, c.name, c.state
              FROM localities l
              JOIN cities c ON c.id = l.city_id
              CROSS APPLY hl_similarity('locality', l.id, @text) sim
              WHERE l.is_active = 1 AND c.is_active = 1
                AND (@city IS NULL OR c.slug = @city)
                AND (l.name LIKE @contains ESCAPE '\' OR sim.similarity >= 0.3)
ORDER BY CASE WHEN l.name LIKE @prefix ESCAPE '\' THEN 0
              WHEN l.name LIKE @contains ESCAPE '\' THEN 1
              ELSE 2 END,
                       sim.similarity DESC,
                       l.name");
        command.Parameters.Add(new SqlParameter("city", SqlDbType.NVarChar) { Value = (object?)query.CitySlug ?? DBNull.Value });
        command.Parameters.AddWithValue("text", query.Text);
        command.Parameters.AddWithValue("prefix", query.PrefixPattern);
        command.Parameters.AddWithValue("contains", query.ContainsPattern);
        command.Parameters.AddWithValue("max", query.Limit);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var suggestions = new List<LocalitySuggestionDto>();
        while (await reader.ReadAsync(ct))
        {
            suggestions.Add(new LocalitySuggestionDto(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3)));
        }

        // An empty list rather than 404: "nothing matched what you typed" is a normal answer here.
        return Results.Ok(suggestions);
    }

    /// <summary>
    /// Resolves coordinates to the closest locality we know about, using the existing
    /// localities_center_gix index (&lt;-&gt; is the indexed nearest-neighbour operator).
    ///
    /// This stands in for a paid reverse geocoder: decision D14's maps provider is still open, and
    /// for the localities we hold this needs no provider and no key. The distance comes back so the
    /// caller can warn the visitor when the nearest known area is far from where they are.
    /// </summary>
    private static async Task<IResult> GetNearestLocality(
        double? lat,
        double? lng,
        SqlDatabase db,
        CancellationToken ct)
    {
        var query = NearestLocalityQuery.TryCreate(lat, lng, out var error);
        if (query is null)
        {
            return Results.Problem(error, statusCode: StatusCodes.Status400BadRequest);
        }

        await using var command = db.CreateCommand(
            /* STDistance is SQL Server's ST_Distance and answers in metres on a geography, exactly
               as PostGIS did. The nearest row is TOP (1) by that distance: SQL Server has no <->
               operator, and with a spatial index an ORDER BY on STDistance is the same plan. */
            @"SELECT TOP (1) l.slug, l.name, c.name, c.state, l.center.STDistance(p.pt)
              FROM (SELECT geography::Point(@lat, @lng, 4326) AS pt) p
              JOIN localities l ON l.is_active = 1
              JOIN cities c ON c.id = l.city_id AND c.is_active = 1
              ORDER BY l.center.STDistance(p.pt)");
        command.Parameters.AddWithValue("lat", query.Latitude);
        command.Parameters.AddWithValue("lng", query.Longitude);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            // Only reachable if there are no active localities at all.
            return Results.NotFound();
        }

        return Results.Ok(new NearestLocalityDto(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            (int)Math.Round(reader.GetDouble(4))));
    }

    private static async Task<IResult> GetCategories(SqlDatabase db, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            /* search_terms was a text[] column; it is the category_search_terms table now, so the
               words come back as one comma-separated string and are split here. A search term with a
               comma in it would be split wrongly, which is why the seed does not use any.

               dbo. is spelled out on this one table because an empty copy of it exists in the
               production login's own schema, left behind by a repair script that said CREATE TABLE
               without a schema. The login's default schema is not dbo, and SQL Server resolves an
               unqualified name against the login's schema before dbo -- so the stray empty table
               would win here and every category would come back with no search terms, silently,
               with no error anywhere. Qualifying it is proof against that. */
            @"SELECT c.id, c.parent_id, c.slug, c.name,
                     (SELECT STRING_AGG(t.term, ',') FROM dbo.category_search_terms t WHERE t.category_id = c.id)
              FROM categories c
              WHERE c.is_active = 1
              ORDER BY c.level, c.sort_order, c.name");
        await using var reader = await command.ExecuteReaderAsync(ct);

        var parents = new List<(int Id, CategoryDto Dto)>();
        var childrenByParent = new Dictionary<int, List<SubCategoryDto>>();
        while (await reader.ReadAsync(ct))
        {
            var id = reader.GetInt32(0);
            var slug = reader.GetString(2);
            var name = reader.GetString(3);
            if (reader.IsDBNull(1))
            {
                var dto = new CategoryDto(slug, name, new List<SubCategoryDto>());
                parents.Add((id, dto));
                childrenByParent[id] = dto.Children;
            }
            else if (childrenByParent.TryGetValue(reader.GetInt32(1), out var siblings))
            {
                var terms = reader.IsDBNull(4)
                    ? []
                    : reader.GetString(4).Split(',', StringSplitOptions.RemoveEmptyEntries);
                siblings.Add(new SubCategoryDto(slug, name, terms));
            }
        }
        return Results.Ok(parents.Select(p => p.Dto));
    }

    private static async Task<IResult> GetNearby(
        double lat,
        double lng,
        string? category,
        double? radiusKm,
        int? limit,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (lat is < -90 or > 90 || lng is < -180 or > 180)
        {
            return Results.Problem("lat must be between -90 and 90, and lng between -180 and 180.", statusCode: StatusCodes.Status400BadRequest);
        }

        var radiusMetres = Math.Clamp(radiusKm ?? 10, 0.1, 50) * 1000;
        var max = Math.Clamp(limit ?? 20, 1, 50);

        await using var command = db.CreateCommand(
            @"SELECT TOP (@max) li.slug, li.name, ci.slug, lo.slug, lo.name, pc.slug, pc.name,
                     li.location.STDistance(p.pt), li.address_line, li.phone_primary, li.phone_whatsapp,
                     pcparent.slug AS parent_category_slug
              FROM (SELECT geography::Point(@lat, @lng, 4326) AS pt) p
              -- ST_DWithin(a, b, r) meant within r metres, which is a plain distance comparison
              -- here. The spatial index is still used: SQL Server recognises STDistance() <= value.
              JOIN listings li ON li.status = 'active' AND li.location.STDistance(p.pt) <= @radius
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              JOIN categories pc ON pc.id = lc.category_id
              -- The parent of the primary category, because a public path starts with it. Inner,
              -- not left: a listing with no parent category has no page to point a card at.
              JOIN categories pcparent ON pcparent.id = pc.parent_id
              WHERE (@cat IS NULL OR EXISTS (
                        SELECT 1
                        FROM listing_categories x
                        JOIN categories xc ON xc.id = x.category_id
                        LEFT JOIN categories xp ON xp.id = xc.parent_id
                        WHERE x.listing_id = li.id AND (xc.slug = @cat OR xp.slug = @cat)))
              ORDER BY li.location.STDistance(p.pt)");
        command.Parameters.AddWithValue("lat", lat);
        command.Parameters.AddWithValue("lng", lng);
        command.Parameters.AddWithValue("radius", radiusMetres);
        command.Parameters.Add(new SqlParameter("cat", SqlDbType.NVarChar) { Value = (object?)category ?? DBNull.Value });
        command.Parameters.AddWithValue("max", max);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var results = new List<NearbyListingDto>();
        while (await reader.ReadAsync(ct))
        {
            var slug = reader.GetString(0);
            var citySlug = reader.GetString(2);
            var localitySlug = reader.GetString(3);
            var categorySlug = reader.GetString(5);
            results.Add(new NearbyListingDto(
                slug,
                reader.GetString(1),
                citySlug,
                localitySlug,
                reader.GetString(4),
                categorySlug,
                reader.GetString(6),
                (int)Math.Round(reader.GetDouble(7)),
                reader.IsDBNull(8) ? null : reader.GetString(8),
                reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                PublicUrl.ForListing(reader.GetString(11), categorySlug, slug)!));
        }
        return Results.Ok(results);
    }

    /// <summary>
    /// One listing, addressed as /parent-category/category/slug.
    ///
    /// The slug alone identifies it — S0015 made that unique across the whole directory — so the
    /// two category segments are verified rather than searched on. That is deliberate: a listing
    /// refiled under a different category is still found, and the caller is told the path it
    /// should be using instead of getting a 404 for a page that exists.
    /// </summary>
    private static async Task<IResult> GetListing(
        string parentCategorySlug, string categorySlug, string slug, SqlDatabase db, IMediaStorage storage, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            @"SELECT li.slug, li.name, li.description, li.address_line, li.pincode, li.phone_primary, li.phone_whatsapp,
                     li.website_url, li.location.Lat, li.location.Long,
                     ci.slug, ci.name, lo.slug, lo.name, pc.slug, pc.name, li.id,
                     -- The badge comes from the entitlement view, never from li.plan_slug: that
                     -- column says what was bought, the view says what is still paid for.
                     e.is_verified,
                     pcparent.slug AS parent_category_slug
              FROM listings li
              JOIN dbo.listing_entitlements e ON e.listing_id = li.id
              JOIN localities lo ON lo.id = li.locality_id
              JOIN cities ci ON ci.id = lo.city_id
              JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              JOIN categories pc ON pc.id = lc.category_id
              JOIN categories pcparent ON pcparent.id = pc.parent_id
              WHERE li.slug = @slug AND li.status = 'active'");
        command.Parameters.AddWithValue("slug", slug);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return Results.NotFound();
        }

        var actualCategorySlug = reader.GetString(14);
        var listingId = reader.GetInt64(16);
        var isVerified = reader.GetBoolean(17);
        var actualParentSlug = reader.GetString(18);

        /* The slug found a listing; the path has to agree before it is served. Answering on the
           wrong category path would give one listing two live URLs, which is the duplicate-content
           problem canonical tags exist to clean up after. 404 here, and the website turns it into
           a redirect to the right path using the Url on the DTO it gets from the correct one. */
        if (!string.Equals(actualCategorySlug, categorySlug, StringComparison.Ordinal) ||
            !string.Equals(actualParentSlug, parentCategorySlug, StringComparison.Ordinal))
        {
            return Results.NotFound();
        }

        // Read the media before the DTO is built, while this reader is still open: it runs on its own
        // connection from the pool, so the two queries do not get in each other's way.
        var media = await ReadPublicMedia(db, listingId, storage, ct);

        // Only a listing that is paid up shows its links. Gating the read rather than filtering
        // afterwards means a lapsed listing's links never leave the database at all.
        var links = isVerified ? await ReadPublicLinks(db, listingId, ct) : [];
        var (hours, openStatus) = await ReadOpeningHours(db, listingId, ct);
        var faqs = await ReadPublicFaqs(db, listingId, ct);
        var contentSections = await ReadPublicContent(db, listingId, ct);

        return Results.Ok(new ListingDetailDto(
            reader.GetString(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.IsDBNull(7) ? null : reader.GetString(7),
            reader.GetDouble(8),
            reader.GetDouble(9),
            reader.GetString(10),
            reader.GetString(11),
            reader.GetString(12),
            reader.GetString(13),
            actualCategorySlug,
            reader.GetString(15),
            PublicUrl.ForListing(actualParentSlug, actualCategorySlug, reader.GetString(0))!,
            media,
            isVerified,
            links,
            hours,
            openStatus,
            faqs,
            contentSections));
    }

    /// <summary>
    /// The week's hours and whether the business is open right now.
    ///
    /// The status is worked out here rather than in the browser so every visitor gets Hyderabad's
    /// answer: these are wall-clock times, and a phone in another timezone would otherwise decide
    /// a shop was shut because of where its owner is standing.
    /// </summary>
    private static async Task<(List<OpeningHoursDto> Week, OpenStatusDto? Status)> ReadOpeningHours(
        SqlDatabase db, long listingId, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            @"SELECT day_of_week, opens_at, closes_at
              FROM dbo.listing_opening_hours
              WHERE listing_id = @listing
              ORDER BY day_of_week, opens_at");
        command.Parameters.AddWithValue("listing", listingId);

        var week = new List<OpeningHoursDto>();
        var intervals = new List<Listings.OpeningHours.Interval>();

        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var day = reader.GetByte(0);
                var opens = TimeOnly.FromTimeSpan(reader.GetTimeSpan(1));
                var closes = TimeOnly.FromTimeSpan(reader.GetTimeSpan(2));

                week.Add(new OpeningHoursDto(
                    day, Listings.OpeningHours.DayNames[day], opens.ToString("HH:mm"), closes.ToString("HH:mm")));
                intervals.Add(new Listings.OpeningHours.Interval(day, opens, closes));
            }
        }

        if (intervals.Count == 0)
        {
            // No hours set is not the same as closed, so no status is reported at all and the page
            // simply says nothing rather than claiming the business is shut.
            return (week, null);
        }

        var status = Listings.OpeningHours.StatusAt(intervals, DateTimeOffset.UtcNow);
        return (week, new OpenStatusDto(
            status.IsOpenNow,
            status.ClosesAt?.ToString("HH:mm"),
            status.OpensAt?.ToString("HH:mm"),
            status.OpensDayName));
    }

    /// <summary>
    /// FAQs within the plan's current allowance. Read from listing_visible_faqs, so a lapsed plan
    /// hides them without anything being deleted and a renewal brings them straight back.
    /// </summary>
    private static async Task<List<PublicFaqDto>> ReadPublicFaqs(
        SqlDatabase db, long listingId, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            @"SELECT question, answer FROM dbo.listing_visible_faqs
              WHERE listing_id = @listing ORDER BY sort_order, id");
        command.Parameters.AddWithValue("listing", listingId);

        var faqs = new List<PublicFaqDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            faqs.Add(new PublicFaqDto(reader.GetString(0), reader.GetString(1)));
        }

        return faqs;
    }

    /// <summary>Content sections within the plan's current allowance. Same rule as the FAQs.</summary>
    private static async Task<List<PublicContentDto>> ReadPublicContent(
        SqlDatabase db, long listingId, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            @"SELECT heading, body FROM dbo.listing_visible_content
              WHERE listing_id = @listing ORDER BY sort_order, id");
        command.Parameters.AddWithValue("listing", listingId);

        var sections = new List<PublicContentDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            sections.Add(new PublicContentDto(reader.GetString(0), reader.GetString(1)));
        }

        return sections;
    }

    /// <summary>
    /// The listing's website and social links, in the owner's chosen order. Only ever called for a
    /// listing the entitlement view reports as paid up.
    /// </summary>
    private static async Task<List<PublicLinkDto>> ReadPublicLinks(SqlDatabase db, long listingId, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            @"SELECT link_type, label, url
              FROM dbo.listing_links
              WHERE listing_id = @listing
              ORDER BY sort_order");
        command.Parameters.AddWithValue("listing", listingId);

        var links = new List<PublicLinkDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            links.Add(new PublicLinkDto(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
        }

        return links;
    }

    /// <summary>
    /// The listing's visible media, logo first, then photos, then video, each in its display order.
    ///
    /// From <c>dbo.listing_visible_media</c>, which caps each kind at what the plan allows *now*
    /// (S0012). Reading <c>listing_media</c> directly is the bug that view exists to prevent: a
    /// lapsed listing kept showing all ten photos, because `is_hidden` was the only filter and
    /// nothing has ever set it.
    /// </summary>
    private static async Task<List<PublicMediaDto>> ReadPublicMedia(
        SqlDatabase db, long listingId, IMediaStorage storage, CancellationToken ct)
    {
        await using var command = db.CreateCommand(
            @"SELECT kind, storage_key, width, height
              FROM dbo.listing_visible_media
              WHERE listing_id = @listing
              ORDER BY CASE kind WHEN 'logo' THEN 0 WHEN 'photo' THEN 1 ELSE 2 END, sort_order, id");
        command.Parameters.AddWithValue("listing", listingId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        var media = new List<PublicMediaDto>();
        while (await reader.ReadAsync(ct))
        {
            media.Add(new PublicMediaDto(
                reader.GetString(0),
                storage.PublicUrl(reader.GetString(1)),
                reader.IsDBNull(2) ? null : reader.GetInt32(2),
                reader.IsDBNull(3) ? null : reader.GetInt32(3)));
        }
        return media;
    }
}
