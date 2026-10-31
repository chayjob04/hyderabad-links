using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

// Named homepage shelves. What is testable without a database is the rule about what a shelf must
// have, and the cap on how many can be on the page at once.
public class HomepageGroupTests
{
    [Fact]
    public void A_shelf_needs_a_heading()
    {
        Assert.Null(SuperAdminHomepageGroupEndpoints.Validate("Best cafes in Madhapur"));

        var errors = SuperAdminHomepageGroupEndpoints.Validate("");
        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("title"));
    }

    [Fact]
    public void A_heading_longer_than_the_column_is_refused_rather_than_truncated()
    {
        // The column is nvarchar(160). Refusing beats cutting a heading in half on the homepage.
        var errors = SuperAdminHomepageGroupEndpoints.Validate(new string('t', 161));

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("title"));
    }

    [Fact]
    public void Exactly_at_the_limit_is_accepted()
    {
        Assert.Null(SuperAdminHomepageGroupEndpoints.Validate(new string('t', 160)));
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
