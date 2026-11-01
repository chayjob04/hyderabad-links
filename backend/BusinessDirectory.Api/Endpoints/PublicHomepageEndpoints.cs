using BusinessDirectory.Api.Data;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// What staff have curated for the homepage, under /api/v1/public/homepage (S0025).
///
/// A new endpoint rather than two new fields on <c>/categories</c>, deliberately. That tree is read
/// by all three sites and by the search box on every page; widening it for something only the
/// homepage renders would make every one of those requests carry it. Nothing existing changed shape
/// to add this.
///
/// Both lists are allowed to come back empty, and that is the normal state until somebody curates
/// something. The homepage falls back to what it did before — the category tree in its own order,
/// and a strip derived from that tree — so this endpoint returning nothing is not a broken page.
/// </summary>
public static class PublicHomepageEndpoints
{
    /// <summary>A category staff put at the front of the homepage.</summary>
    public sealed record PopularCategoryDto(
        string Slug,
        string Name,
        /// <summary>The top-level category above it, or null when this *is* a top-level one. The
        /// public URL of a subcategory is /parent/child, so a card cannot link without it.</summary>
        string? ParentSlug);

    /// <summary>One line on the scrolling strip. <c>Url</c> is a site-relative path or null.</summary>
    public sealed record ScrollingTextDto(string Message, string? Url);

    public sealed record HomepageDto(
        IReadOnlyList<PopularCategoryDto> PopularCategories,
        IReadOnlyList<ScrollingTextDto> ScrollingText);

    public static RouteGroupBuilder MapPublicHomepageEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/homepage", GetHomepage);
        return group;
    }

    private static async Task<IResult> GetHomepage(SqlDatabase db, CancellationToken ct)
    {
        var categories = new List<PopularCategoryDto>();
        await using (var command = db.CreateCommand(
            @"SELECT c.slug, c.name, parent.slug AS parent_slug
              FROM dbo.categories c
              LEFT JOIN dbo.categories parent ON parent.id = c.parent_id
              WHERE c.is_popular = 1
                AND c.is_active = 1
                -- A subcategory whose parent was retired has no public URL, so it cannot be a card.
                AND (c.parent_id IS NULL OR parent.is_active = 1)
              ORDER BY c.sort_order, c.name"))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                categories.Add(new PopularCategoryDto(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2)));
            }
        }

        var lines = new List<ScrollingTextDto>();
        await using (var command = db.CreateCommand(
            @"SELECT message, url FROM dbo.scrolling_texts
              WHERE is_active = 1 ORDER BY sort_order, id"))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                lines.Add(new ScrollingTextDto(
                    reader.GetString(0),
                    reader.IsDBNull(1) ? null : reader.GetString(1)));
            }
        }

        return Results.Ok(new HomepageDto(categories, lines));
    }
}
