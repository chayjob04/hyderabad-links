using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Media;
using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// The two homepage shelves, under /api/v1/public/listings/highlights.
///
/// Both are built from rows the database already holds. Nothing here scores a listing on a number
/// the application invented:
///
///   Featured — listings a super admin has chosen by hand, most recently chosen first. The one
///              curated thing on the page, and deliberately a decision with a name against it
///              (S0017). It used to mean "is paying right now", which made it a list of whoever had
///              bought the Verified plan — useful, but not a recommendation anyone had made.
///   Trending — listings with the most real activity in the last 30 days: enquiries sent to them,
///              favourites saved against them, and approved reviews written about them. A listing
///              with no activity in the window never appears, so an empty shelf is an honest empty
///              shelf rather than a filler list.
///
/// The counts are deliberately NOT returned to the browser. How many enquiries a business receives
/// is its own commercial information, and a public endpoint that reported it would hand every
/// competitor a lead-volume report. The ordering carries the signal; the numbers stay server-side.
/// </summary>
public static class PublicHighlightsEndpoints
{
    /// <summary>How far back "trending" looks. Thirty days is long enough that a quiet week does not empty the shelf.</summary>
    private const int TrendingWindowDays = 30;

    /// <summary>Shelf size. Eight fills a four-up grid on two rows and keeps the homepage query small.</summary>
    private const int ShelfSize = 8;

    public sealed record HighlightDto(
        string Slug,
        string Name,
        string CitySlug,
        string LocalitySlug,
        string LocalityName,
        string CategorySlug,
        string CategoryName,
        string? AddressLine,
        string PhonePrimary,
        string? PhoneWhatsapp,
        string Url,
        string? LogoUrl,
        string? PhotoUrl,
        /// <summary>True while a paid period is running. The card draws the badge from this.</summary>
        bool Verified);

    /// <summary>A named shelf a super admin created, with the listings on it.</summary>
    public sealed record FeaturedGroupDto(
        string Slug, string Title, string? Subtitle, IReadOnlyList<HighlightDto> Listings);

    public sealed record HighlightsDto(
        IReadOnlyList<HighlightDto> Featured,
        IReadOnlyList<HighlightDto> Trending,
        /// <summary>So the site can say "most active in the last 30 days" without hard-coding the number twice.</summary>
        int TrendingWindowDays,

        /// <summary>
        /// Named shelves, in the order staff chose. Empty when nobody has made one, which is the
        /// normal state -- the default Featured shelf above is unaffected either way.
        /// </summary>
        IReadOnlyList<FeaturedGroupDto> FeaturedGroups);

    public static RouteGroupBuilder MapPublicHighlightsEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/listings/highlights", GetHighlights);
        return group;
    }

    // The card columns, shared by both shelves so the two lists cannot drift apart in shape.
    // Hidden media is skipped the same way the search does it: a listing that lapsed from Verified
    // keeps its files, but the ones over the free allowance stop being shown.
    private const string CardColumns = @"
        li.slug, li.name, c.slug AS city_slug, lo.slug AS locality_slug, lo.name AS locality_name,
        cat.slug AS category_slug, cat.name AS category_name, li.address_line,
        li.phone_primary, li.phone_whatsapp,
        -- listing_visible_media (S0012), not listing_media: the view applies the plan's current
        -- allowance, so a lapsed listing loses its logo from these shelves at the same moment it
        -- loses it from its own page.
        (SELECT m.storage_key FROM dbo.listing_visible_media m
         WHERE m.listing_id = li.id AND m.kind = 'logo'
         ORDER BY m.sort_order, m.id OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY) AS logo_key,
        (SELECT m.storage_key FROM dbo.listing_visible_media m
         WHERE m.listing_id = li.id AND m.kind = 'photo'
         ORDER BY m.sort_order, m.id OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY) AS photo_key,
        e.is_verified,
        -- The parent of the primary category. A public path is /parent/category/slug, so a card
        -- cannot link anywhere without it. INNER JOIN below, deliberately.
        catparent.slug AS parent_category_slug";

    // The joins every card needs: its locality, its city, and its primary category.
    private const string CardJoins = @"
        FROM listings li
        JOIN localities lo ON lo.id = li.locality_id
        JOIN cities c ON c.id = lo.city_id
        JOIN listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
        JOIN categories cat ON cat.id = lc.category_id
        -- Inner, not left: a listing filed directly under a top-level category has no public page
        -- to link to, so it does not belong on a shelf. Writes only ever file under level 2
        -- (ListingWriter.FindCategoryId), so this excludes nothing that exists today.
        JOIN categories catparent ON catparent.id = cat.parent_id
        JOIN listing_entitlements e ON e.listing_id = li.id";

    private static async Task<IResult> GetHighlights(
        string? city,
        SqlDatabase db,
        IMediaStorage storage,
        CancellationToken ct)
    {
        var featured = await ReadFeatured(db, storage, city, ct);
        var trending = await ReadTrending(db, storage, city, ct);

        var groups = await ReadFeaturedGroups(db, storage, city, ct);

        return Results.Ok(new HighlightsDto(featured, trending, TrendingWindowDays, groups));
    }

    /// <summary>
    /// The listings a super admin has chosen, most recently chosen first (S0017).
    ///
    /// This was "every listing with a paid Verified period running", which made the shelf a list of
    /// whoever had paid rather than a recommendation anyone stood behind. It is now a decision, taken
    /// on the super-admin surface and recorded with who took it.
    ///
    /// `status = 'active'` is still checked here even though featuring refuses a listing that is not
    /// live: a featured listing can be suspended afterwards, and the homepage must drop it the moment
    /// it is, rather than keep a card that leads to a page the public cannot see.
    /// </summary>
    private static async Task<List<HighlightDto>> ReadFeatured(
        SqlDatabase db, IMediaStorage storage, string? city, CancellationToken ct)
    {
        await using var command = db.CreateCommand($@"
            SELECT TOP (@take) {CardColumns}
            {CardJoins}
            WHERE li.status = 'active'
              AND li.featured_at IS NOT NULL
              AND li.homepage_group_id IS NULL
              AND (@city IS NULL OR c.slug = @city)
            ORDER BY li.featured_at DESC, li.name");
        command.Parameters.AddWithValue("take", ShelfSize);
        command.Parameters.AddWithValue("city", (object?)city ?? DBNull.Value);

        return await ReadCards(command, storage, ct);
    }

    /// <summary>
    /// Ranked by real events inside the window. The three counts are summed with no weighting: an
    /// enquiry, a favourite and a review each count once, because any weighting between them would
    /// be a number this project made up.
    /// </summary>
    private static async Task<List<HighlightDto>> ReadTrending(
        SqlDatabase db, IMediaStorage storage, string? city, CancellationToken ct)
    {
        await using var command = db.CreateCommand($@"
            WITH window_start AS (SELECT DATEADD(day, -@days, SYSDATETIMEOFFSET()) AS since),
            activity AS (
                SELECT li.id AS listing_id,
                       (SELECT COUNT_BIG(*) FROM enquiries q, window_start w
                        WHERE q.listing_id = li.id AND q.created_at >= w.since)
                     + (SELECT COUNT_BIG(*) FROM favourites f, window_start w
                        WHERE f.listing_id = li.id AND f.created_at >= w.since)
                     + (SELECT COUNT_BIG(*) FROM reviews r, window_start w
                        WHERE r.listing_id = li.id AND r.status = 'approved' AND r.created_at >= w.since)
                       AS events
                FROM listings li
                WHERE li.status = 'active'
            )
            SELECT TOP (@take) {CardColumns}
            {CardJoins}
            JOIN activity a ON a.listing_id = li.id
            WHERE li.status = 'active'
              AND a.events > 0
              AND (@city IS NULL OR c.slug = @city)
            ORDER BY a.events DESC, li.published_at DESC, li.name");
        command.Parameters.AddWithValue("take", ShelfSize);
        command.Parameters.AddWithValue("days", TrendingWindowDays);
        command.Parameters.AddWithValue("city", (object?)city ?? DBNull.Value);

        return await ReadCards(command, storage, ct);
    }

    private static async Task<List<HighlightDto>> ReadCards(
        Microsoft.Data.SqlClient.SqlCommand command, IMediaStorage storage, CancellationToken ct)
    {
        var cards = new List<HighlightDto>();

        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var slug = reader.GetString(0);
            var citySlug = reader.GetString(2);
            var localitySlug = reader.GetString(3);
            var categorySlug = reader.GetString(5);

            cards.Add(new HighlightDto(
                slug,
                reader.GetString(1),
                citySlug,
                localitySlug,
                reader.GetString(4),
                categorySlug,
                reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.GetString(8),
                reader.IsDBNull(9) ? null : reader.GetString(9),
                PublicUrl.ForListing(reader.GetString(13), categorySlug, slug)!,
                reader.IsDBNull(10) ? null : storage.PublicUrl(reader.GetString(10)),
                reader.IsDBNull(11) ? null : storage.PublicUrl(reader.GetString(11)),
                Verified: reader.GetBoolean(12)));
        }

        return cards;
    }

    /// <summary>
    /// The named shelves, each with its own listings.
    ///
    /// One query for the groups and one per group for its cards. That is N+1, and it is the right
    /// trade here: there are at most four active groups (SuperAdminHomepageGroupEndpoints caps it),
    /// the alternative is a window function over every featured listing that the card join makes
    /// awkward to read, and this page is cached. Readability wins at this size.
    ///
    /// A group with no live listings is left out entirely rather than rendered as a heading over
    /// nothing, which is the same rule the Featured and Trending shelves follow.
    /// </summary>
    private static async Task<List<FeaturedGroupDto>> ReadFeaturedGroups(
        SqlDatabase db, IMediaStorage storage, string? city, CancellationToken ct)
    {
        var groups = new List<(int Id, string Slug, string Title, string? Subtitle)>();

        await using (var command = db.CreateCommand(
            @"SELECT id, slug, title, subtitle FROM dbo.homepage_groups
              WHERE is_active = 1 ORDER BY sort_order, id"))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                groups.Add((
                    reader.GetInt32(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3)));
            }
        }

        var shelves = new List<FeaturedGroupDto>();
        foreach (var group in groups)
        {
            await using var command = db.CreateCommand($@"
                SELECT TOP (@take) {CardColumns}
                {CardJoins}
                WHERE li.status = 'active'
                  AND li.featured_at IS NOT NULL
                  AND li.homepage_group_id = @group
                  AND (@city IS NULL OR c.slug = @city)
                ORDER BY li.featured_at DESC, li.name");
            command.Parameters.AddWithValue("take", ShelfSize);
            command.Parameters.AddWithValue("group", group.Id);
            command.Parameters.AddWithValue("city", (object?)city ?? DBNull.Value);

            var cards = await ReadCards(command, storage, ct);
            if (cards.Count > 0)
            {
                shelves.Add(new FeaturedGroupDto(group.Slug, group.Title, group.Subtitle, cards));
            }
        }

        return shelves;
    }
}
