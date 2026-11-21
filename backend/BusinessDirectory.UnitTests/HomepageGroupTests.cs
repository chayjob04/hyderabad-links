using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

// Named homepage shelves. What is testable without a database is the rule about what a shelf must
// have, and the cap on how many can be on the page at once.
public class HomepageGroupTests
{
    [Fact]
    public void A_shelf_needs_a_heading()
    {
        Assert.Null(SuperAdminHomepageGroupEndpoints.Validate("Best cafes in Madhapur", null));

        var errors = SuperAdminHomepageGroupEndpoints.Validate("", null);
        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("title"));
    }

    [Fact]
    public void A_heading_longer_than_the_column_is_refused_rather_than_truncated()
    {
        // The column is nvarchar(160). Refusing beats cutting a heading in half on the homepage.
        var errors = SuperAdminHomepageGroupEndpoints.Validate(new string('t', 161), null);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("title"));
    }

    [Fact]
    public void Exactly_at_the_limit_is_accepted()
    {
        Assert.Null(SuperAdminHomepageGroupEndpoints.Validate(new string('t', 160), null));
    }

    // ---- the subtitle, which had no rule at all until now ---------------------------------------

    [Fact]
    public void A_subtitle_is_optional()
    {
        // Null and empty are both "no subtitle", and a shelf does not need one.
        Assert.Null(SuperAdminHomepageGroupEndpoints.Validate("Best cafes", null));
        Assert.Null(SuperAdminHomepageGroupEndpoints.Validate("Best cafes", ""));
        Assert.Null(SuperAdminHomepageGroupEndpoints.Validate("Best cafes", "Where Hyderabad takes its chai"));
    }

    [Fact]
    public void A_subtitle_exactly_at_the_limit_is_accepted()
    {
        Assert.Null(SuperAdminHomepageGroupEndpoints.Validate(
            "Best cafes", new string('s', SuperAdminHomepageGroupEndpoints.MaxSubtitleLength)));
    }

    [Fact]
    public void A_subtitle_longer_than_the_column_is_refused_with_its_own_field_name()
    {
        /* The column is nvarchar(300) and nothing in the API checked it, so SQL Server did: the
           super admin got a 500 from a truncation error, with nothing naming the field. */
        var errors = SuperAdminHomepageGroupEndpoints.Validate(
            "Best cafes", new string('s', SuperAdminHomepageGroupEndpoints.MaxSubtitleLength + 1));

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("subtitle"));
        Assert.False(errors.ContainsKey("title"));
    }

    [Fact]
    public void The_limits_match_the_columns()
    {
        /* Asserted so that changing either one is a deliberate edit made alongside a migration,
           rather than a drift that is only found when a save fails in production. */
        Assert.Equal(160, SuperAdminHomepageGroupEndpoints.MaxTitleLength);
        Assert.Equal(300, SuperAdminHomepageGroupEndpoints.MaxSubtitleLength);
    }

    [Fact]
    public void The_homepage_holds_a_small_number_of_shelves()
    {
        /* The cap exists so the front page stays a front door. Past a handful of shelves it
           becomes a second set of search results, which is the page it is supposed to save people
           from. The number is asserted so raising it is a deliberate edit rather than a drift. */
        Assert.Equal(4, SuperAdminHomepageGroupEndpoints.MaxActiveGroups);
    }
}
