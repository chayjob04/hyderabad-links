using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.UnitTests;

// The three short lists a business is described by: what it offers, what it has on site, and what
// languages it speaks. The original kept these in three tables; here they are one with a kind, so
// these tests are mostly about that kind column being the thing that keeps them apart.
public class ListingAttributesTests
{
    [Theory]
    [InlineData("offering")]
    [InlineData("language")]
    [InlineData("amenity")]
    public void Every_kind_the_database_allows_is_accepted(string kind)
    {
        // The CHECK constraint in S0024 lists exactly these three. If this and the constraint ever
        // disagree, a kind the API accepts would be refused on insert.
        Assert.Null(ListingAttributes.Validate(kind, "Telugu"));
        Assert.True(ListingAttributes.Kinds.ContainsKey(kind));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("service")]
    [InlineData("Offering")]
    public void A_kind_outside_the_list_is_refused(string? kind)
    {
        // Case included deliberately: the stored values are lower case, and accepting "Offering"
        // here would hand the database a value its constraint rejects.
        var errors = ListingAttributes.Validate(kind, "Telugu");

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("kind"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_label_is_refused(string label)
    {
        var errors = ListingAttributes.Validate("language", label);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("label"));
    }

    [Fact]
    public void A_label_longer_than_the_column_is_refused_rather_than_truncated()
    {
        // The column is nvarchar(80). Cutting a label in half on a public page is worse than
        // refusing it, and a 500 from the database is worse than both.
        var errors = ListingAttributes.Validate(
            "offering", new string('a', ListingAttributes.MaxLabelLength + 1));

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("label"));
    }

    [Fact]
    public void Exactly_at_the_limit_is_accepted()
    {
        Assert.Null(ListingAttributes.Validate("offering", new string('a', ListingAttributes.MaxLabelLength)));
    }

    [Fact]
    public void Both_problems_are_reported_at_once()
    {
        var errors = ListingAttributes.Validate("not-a-kind", "");

        Assert.NotNull(errors);
        Assert.Equal(2, errors.Count);
    }

    [Fact]
    public void Every_kind_has_a_suggestion_list_even_when_it_is_empty()
    {
        /* The form reads suggestions[kind] for each kind it renders. A missing key would be an
           undefined on the frontend; offerings have an empty array on purpose, because they are
           specific to the trade and suggesting any would suggest the wrong ones to most
           businesses. */
        foreach (var kind in ListingAttributes.Kinds.Keys)
        {
            Assert.True(ListingAttributes.Suggestions.ContainsKey(kind), kind);
        }

        Assert.Empty(ListingAttributes.Suggestions["offering"]);
        Assert.NotEmpty(ListingAttributes.Suggestions["language"]);
    }

    [Fact]
    public void The_suggested_languages_are_the_ones_Hyderabad_speaks()
    {
        // Not decoration: a plumber who speaks Telugu and a customer who only speaks Telugu are
        // the match this field exists to make.
        var languages = ListingAttributes.Suggestions["language"];

        Assert.Contains("Telugu", languages);
        Assert.Contains("Hindi", languages);
        Assert.Contains("Urdu", languages);
        Assert.Contains("English", languages);
    }

    [Fact]
    public void Every_suggestion_would_be_accepted_if_submitted()
    {
        // A suggestion the API then refuses is a button that cannot work.
        foreach (var (kind, suggestions) in ListingAttributes.Suggestions)
        {
            foreach (var suggestion in suggestions)
            {
                Assert.Null(ListingAttributes.Validate(kind, suggestion));
            }
        }
    }

    [Fact]
    public void A_listing_can_hold_a_sensible_number_per_kind()
    {
        // Few enough that the page stays readable: twenty amenities is a list nobody finishes.
        Assert.InRange(ListingAttributes.MaxPerKind, 5, 20);
    }
}
