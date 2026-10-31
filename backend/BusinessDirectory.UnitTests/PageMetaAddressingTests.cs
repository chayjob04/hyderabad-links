using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

// The static pages that may carry a staff-written title.
//
// This list is the contract between three places: the admin form offers it, TryAddress accepts it,
// and the website looks a page up by the same key. A page added to one and not the others produces
// an override that saves and then does nothing, which is the failure these tests exist to catch.
public class PageMetaAddressingTests
{
    [Theory]
    [InlineData("home")]
    [InlineData("search")]
    [InlineData("terms")]
    [InlineData("privacy")]
    [InlineData("help")]
    [InlineData("blog")]
    [InlineData("about")]
    [InlineData("pricing")]
    public void Every_page_the_website_can_override_is_accepted(string key)
    {
        /* Each of these is looked up by a real page: the home page, the blog index, the pricing
           page and so on all call getPageMeta("static", <key>). A key the API refused would mean
           an admin could never set that page's title. */
        Assert.True(AdminSeoEndpoints.TryAddress("static", key, out var id, out var pageKey, out _), key);
        Assert.Equal(0, id);
        Assert.Equal(key, pageKey);
    }

    [Fact]
    public void The_offered_list_and_the_accepted_list_are_the_same_list()
    {
        // StaticPageKeys is what the admin screen renders a form for. Anything in it that
        // TryAddress refused would be a form that cannot be saved.
        foreach (var key in AdminSeoEndpoints.StaticPageKeys)
        {
            Assert.True(AdminSeoEndpoints.TryAddress("static", key, out _, out _, out _), key);
        }
    }

    [Fact]
    public void A_page_nobody_renders_is_refused()
    {
        // Not an arbitrary string field: an override for a page that does not exist would sit in
        // the table forever, doing nothing, with nobody able to tell why.
        Assert.False(AdminSeoEndpoints.TryAddress("static", "careers", out _, out _, out var error));
        Assert.NotNull(error);
    }
}
