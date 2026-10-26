using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.UnitTests;

// Every public path in one place, so the seven handlers that each used to build their own cannot
// disagree. The case that motivated these tests: the receipt email built its own copy of the path
// and would have been the one place still emitting the old shape.
public class PublicUrlTests
{
    [Fact]
    public void A_listing_sits_under_its_category_path()
    {
        Assert.Equal("/food/cafes/garden-cafe", PublicUrl.ForListing("food", "cafes", "garden-cafe"));
    }

    [Theory]
    [InlineData(null, "cafes")]
    [InlineData("food", null)]
    [InlineData("", "cafes")]
    [InlineData("food", "")]
    public void A_listing_with_no_category_has_no_page(string? parent, string? category)
    {
        // The path is built from a category, so a listing without one genuinely has nowhere to be.
        // Null rather than a half-built path like "//garden-cafe", which would 404 confusingly.
        Assert.Null(PublicUrl.ForListing(parent, category, "garden-cafe"));
    }

    [Fact]
    public void Category_pages_exist_at_both_levels()
    {
        Assert.Equal("/food", PublicUrl.ForTopCategory("food"));
        Assert.Equal("/food/cafes", PublicUrl.ForCategory("food", "cafes"));
    }

    [Fact]
    public void Area_pages_live_under_the_reserved_segment()
    {
        Assert.Equal("/areas/madhapur", PublicUrl.ForArea("madhapur"));
        Assert.Equal("/areas/madhapur/cafes", PublicUrl.ForAreaCategory("madhapur", "cafes"));
    }

    [Fact]
    public void An_area_path_and_a_category_path_are_told_apart_by_the_first_segment()
    {
        /* This is the whole reason "areas" is reserved. Both shapes are two segments, and the
           router cannot tell /areas/madhapur from /food/cafes except by that first word — so a
           category slugged "areas" would make every area page unreachable. AdminTaxonomyEndpoints
           refuses that slug; this records why. */
        Assert.StartsWith($"/{PublicUrl.ReservedFirstSegment}/", PublicUrl.ForArea("madhapur"));
        Assert.DoesNotContain($"/{PublicUrl.ReservedFirstSegment}/", PublicUrl.ForCategory("food", "cafes"));
    }

    [Fact]
    public void Every_path_is_rooted()
    {
        // Relative paths would resolve against whatever page emitted them; these are site paths.
        string[] paths =
        [
            PublicUrl.ForListing("food", "cafes", "garden-cafe")!,
            PublicUrl.ForCategory("food", "cafes"),
            PublicUrl.ForTopCategory("food"),
            PublicUrl.ForArea("madhapur"),
            PublicUrl.ForAreaCategory("madhapur", "cafes"),
        ];

        Assert.All(paths, path => Assert.StartsWith("/", path));
        Assert.All(paths, path => Assert.DoesNotContain("//", path));
    }
}
