using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.UnitTests;

public class ListingSearchQueryTests
{
    private static ListingSearchQuery? Create(
        string? q = null,
        string? city = null,
        string? locality = null,
        string? category = null,
        double? lat = null,
        double? lng = null,
        double? radiusKm = null,
        string? sort = null,
        int? page = null,
        int? pageSize = null,
        bool? verified = null) =>
        ListingSearchQuery.TryCreate(
            q, city, locality, category, lat, lng, radiusKm, sort, page, pageSize, verified, out _);

    private static string? ErrorFrom(
        double? lat = null,
        double? lng = null,
        double? radiusKm = null,
        string? sort = null,
        string? q = null)
    {
        ListingSearchQuery.TryCreate(q, null, null, null, lat, lng, radiusKm, sort, null, null, null, out var error);
        return error;
    }

    [Fact]
    public void An_empty_request_is_valid_and_sorts_by_name()
    {
        var query = Create();

        Assert.NotNull(query);
        Assert.Null(query.Text);
        Assert.Equal(ListingSortOrder.Name, query.Sort);
        Assert.Equal(1, query.Page);
        Assert.Equal(ListingSearchQuery.DefaultPageSize, query.PageSize);
        Assert.Equal(0, query.Offset);
    }

    [Fact]
    public void Text_defaults_to_relevance_and_coordinates_alone_default_to_distance()
    {
        Assert.Equal(ListingSortOrder.Relevance, Create(q: "biryani")!.Sort);
        Assert.Equal(ListingSortOrder.Distance, Create(lat: 17.4, lng: 78.4)!.Sort);
        // Text wins: what the visitor typed matters more than where they are.
        Assert.Equal(ListingSortOrder.Relevance, Create(q: "biryani", lat: 17.4, lng: 78.4)!.Sort);
    }

    [Theory]
    [InlineData("  Nawab Biryani  ", "Nawab Biryani")]
    [InlineData("   ", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Blank_text_becomes_null_and_the_rest_is_trimmed(string? input, string? expected) =>
        Assert.Equal(expected, Create(q: input)!.Text);

    [Fact]
    public void Over_long_text_is_cut_rather_than_rejected()
    {
        var query = Create(q: new string('a', ListingSearchQuery.MaxTextLength + 50));

        Assert.NotNull(query);
        Assert.Equal(ListingSearchQuery.MaxTextLength, query.Text!.Length);
    }

    [Theory]
    [InlineData(null, 1, 0)]
    [InlineData(0, 1, 0)]
    [InlineData(-5, 1, 0)]
    [InlineData(3, 3, 40)]
    public void Page_never_falls_below_one_and_drives_the_offset(int? page, int expectedPage, int expectedOffset)
    {
        var query = Create(page: page, pageSize: 20);

        Assert.Equal(expectedPage, query!.Page);
        Assert.Equal(expectedOffset, query.Offset);
    }

    [Theory]
    [InlineData(null, ListingSearchQuery.DefaultPageSize)]
    [InlineData(0, 1)]
    [InlineData(10, 10)]
    [InlineData(5000, ListingSearchQuery.MaxPageSize)]
    public void Page_size_is_clamped(int? requested, int expected) =>
        Assert.Equal(expected, Create(pageSize: requested)!.PageSize);

    [Theory]
    [InlineData(0.0001, ListingSearchQuery.MinRadiusKm)]
    [InlineData(8, 8)]
    [InlineData(9999, ListingSearchQuery.MaxRadiusKm)]
    public void Radius_is_clamped_when_coordinates_are_present(double requested, double expected) =>
        Assert.Equal(expected, Create(lat: 17.4, lng: 78.4, radiusKm: requested)!.RadiusKm);

    [Fact]
    public void Slug_filters_are_trimmed_and_blanks_dropped()
    {
        var query = Create(city: " hyderabad ", locality: "  ", category: " plumbers ");

        Assert.Equal("hyderabad", query!.CitySlug);
        Assert.Null(query.LocalitySlug);
        Assert.Equal("plumbers", query.CategorySlug);
    }

    [Theory]
    [InlineData("relevance", ListingSortOrder.Relevance)]
    [InlineData("name", ListingSortOrder.Name)]
    [InlineData("NAME", ListingSortOrder.Name)]
    [InlineData(" name ", ListingSortOrder.Name)]
    public void Sort_is_accepted_case_insensitively(string sort, ListingSortOrder expected) =>
        Assert.Equal(expected, Create(sort: sort)!.Sort);

    [Fact]
    public void An_unknown_sort_is_rejected()
    {
        Assert.Null(Create(sort: "price"));
        Assert.Contains("sort must be one of", ErrorFrom(sort: "price"));
    }

    [Fact]
    public void Coordinates_must_arrive_as_a_pair()
    {
        Assert.Null(Create(lat: 17.4));
        Assert.Null(Create(lng: 78.4));
        Assert.Contains("together", ErrorFrom(lat: 17.4));
    }

    [Theory]
    [InlineData(91, 78.4)]
    [InlineData(-91, 78.4)]
    [InlineData(17.4, 181)]
    [InlineData(17.4, -181)]
    public void Coordinates_outside_the_world_are_rejected(double lat, double lng)
    {
        Assert.Null(Create(lat: lat, lng: lng));
        Assert.Contains("between", ErrorFrom(lat: lat, lng: lng));
    }

    [Fact]
    public void Distance_sorting_and_a_radius_both_need_coordinates()
    {
        Assert.Null(Create(sort: "distance"));
        Assert.Contains("sort=distance needs lat and lng", ErrorFrom(sort: "distance"));

        Assert.Null(Create(radiusKm: 5));
        Assert.Contains("radiusKm needs lat and lng", ErrorFrom(radiusKm: 5));
    }

    [Fact]
    public void A_search_is_not_verified_only_unless_it_asks()
    {
        // The default has to be false: a true default would silently hide every free listing from
        // ordinary search, which is most of the directory.
        Assert.False(Create()!.VerifiedOnly);
        Assert.False(Create(verified: false)!.VerifiedOnly);
    }

    [Fact]
    public void Asking_for_verified_only_is_carried_through()
    {
        Assert.True(Create(verified: true)!.VerifiedOnly);
    }

    [Fact]
    public void Verified_only_does_not_disturb_anything_else()
    {
        // It is one more predicate in the WHERE clause, not a different query: the sort a visitor
        // chose and the page they are on must survive it.
        var query = Create(q: "biryani", category: "restaurants", sort: "name", page: 3, verified: true)!;

        Assert.True(query.VerifiedOnly);
        Assert.Equal("biryani", query.Text);
        Assert.Equal("restaurants", query.CategorySlug);
        Assert.Equal(ListingSortOrder.Name, query.Sort);
        Assert.Equal(3, query.Page);
    }
}
