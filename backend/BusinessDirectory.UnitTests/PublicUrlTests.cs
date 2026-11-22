using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.UnitTests;

// Every public path in one place, so the seven handlers that each used to build their own cannot
// disagree. The case that motivated these tests: the receipt email built its own copy of the path
// and would have been the one place still emitting the old shape.
public class PublicUrlTests
{
    /// <summary>
    /// No handler builds a public path by hand any more.
    ///
    /// <para>
    /// PublicUrl's own comment warned about this: "a path built in seven places is changed in six,
    /// and the seventh sends somebody to a 404 that nothing fails on." Two handlers were still
    /// building their own when this test was written -- the customer's saved listings and the
    /// customer's own reviews -- and both emitted the pre-S0015 four-segment
    /// <c>/city/locality/category/slug</c> shape. Every link from <c>/my/saved</c> and
    /// <c>/my/profile</c> to a listing was a 404 in production, and nothing failed on it, exactly as
    /// predicted. The shape changed; six places were updated; these two were the seventh.
    /// </para>
    /// <para>
    /// Asserted by reading the source, because the defect is the *absence* of a call: a test that
    /// exercised PublicUrl could never see a handler that declined to use it.
    /// </para>
    /// </summary>
    [Fact]
    public void No_handler_builds_a_public_path_by_hand()
    {
        var root = MigrationRunner.FindDirectory(AppContext.BaseDirectory, "backend", "BusinessDirectory.Api");
        Assert.True(root is not null, "Could not locate the API project from the test assembly.");

        var offenders = new List<string>();
        foreach (var folder in new[] { "Endpoints", "Listings", "Notifications", "Payments" })
        {
            var dir = Path.Combine(root!, folder);
            if (!Directory.Exists(dir)) continue;

            foreach (var file in Directory.GetFiles(dir, "*.cs"))
            {
                if (Path.GetFileName(file) == "PublicUrl.cs") continue;   // the one place allowed to
                var source = File.ReadAllText(file);
                // An interpolated string starting with a slash is a path being assembled.
                if (source.Contains("$\"/{", StringComparison.Ordinal))
                {
                    offenders.Add(Path.GetFileName(file));
                }
            }
        }

        Assert.Empty(offenders);
    }

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
