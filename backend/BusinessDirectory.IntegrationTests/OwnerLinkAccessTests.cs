using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BusinessDirectory.IntegrationTests;

// A listing's website and social links belong to that business: nobody signed out may read them,
// add one, rename one or remove one. These run with no database, so the authorization boundary and
// the request validation that happens before any query are what is testable here.
//
// Since S0029 the entitlement question is no longer "how many links" — every plan has as many as it
// likes — but "who may name them", and that still comes from the listing_entitlements view. Neither
// can be asserted without rows, so both live in database/sqlserver/checks/listing_links_smoke.sql.
public class OwnerLinkAccessTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Listing_links_require_sign_in() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/v1/me/listings/1/links")).StatusCode);

    [Fact]
    public async Task Adding_a_link_requires_sign_in()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/me/listings/1/links",
            new { linkType = "website", label = "Our site", url = "https://example.com" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Deleting_a_link_requires_sign_in() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.DeleteAsync("/api/v1/me/listings/1/links/1")).StatusCode);

    [Fact]
    public async Task A_made_up_token_does_not_open_a_listings_links()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me/listings/1/links");
        request.Headers.Add("Authorization", "Bearer not-a-real-token");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task There_is_no_links_route_on_the_admin_surface() =>
        // Links are the owner's own property, so they are reachable only under /api/v1/me. This
        // asserts 404 and not 401 deliberately: the route is absent from the admin surface rather
        // than present and refused, which is the stronger of the two positions. (It was written
        // expecting 401 and the route map was right and the test wrong.)
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await _client.GetAsync("/api/v1/admin/listings/1/links")).StatusCode);

    // The validation below is refused before the handler reaches the database, so it is testable
    // without one -- but only once a caller is authenticated. Signed out, the 401 comes first, which
    // is itself the thing worth asserting: a bad payload must not be a way to probe the route.
    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("not-a-url")]
    [InlineData("")]
    public async Task A_bad_url_still_answers_unauthorized_when_signed_out(string url)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/me/listings/1/links",
            new { linkType = "website", label = "x", url });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- renaming (S0029) ----------------------------------------------------------------------
    //
    // Renaming an existing link is the Verified plan's "make your own field" applied to what is
    // already there. Whether a given listing *may* rename depends on its subscription period and so
    // needs a database; what is testable here is the boundary, which is the part that must never
    // slip: the route exists, it is closed to anyone signed out, and it is not reachable from the
    // staff surfaces by this address.

    [Fact]
    public async Task Renaming_a_link_requires_sign_in() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.PutAsJsonAsync("/api/v1/me/listings/1/links/1", new { label = "Our menu" }))
                .StatusCode);

    [Fact]
    public async Task A_made_up_token_cannot_rename_a_link()
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, "/api/v1/me/listings/1/links/1")
        {
            Content = JsonContent.Create(new { label = "Our menu" }),
        };
        request.Headers.Add("Authorization", "Bearer not-a-real-token");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task A_blank_new_name_still_answers_unauthorized_when_signed_out() =>
        /* The order matters: authentication comes before validation, so an unauthenticated caller
           cannot use a malformed body to find out whether a link id exists. */
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.PutAsJsonAsync("/api/v1/me/listings/1/links/1", new { label = "" })).StatusCode);

    [Fact]
    public async Task There_is_no_rename_route_on_the_admin_surface() =>
        // Same position as the GET above: absent from the moderation surface, not present and
        // refused. A moderator edits a listing's links through /api/v1/super-admin.
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await _client.PutAsJsonAsync("/api/v1/admin/listings/1/links/1", new { label = "x" }))
                .StatusCode);
}
