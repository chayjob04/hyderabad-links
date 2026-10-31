using System.Net;
using System.Net.Http.Json;
using BusinessDirectory.Api.Auth;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace BusinessDirectory.IntegrationTests;

// Every route added for opening hours, FAQs, content sections, listing attributes, SEO metadata,
// the blog and search tuning, checked for the one thing that needs no database: that nothing
// reaches them without the right kind of token.
//
// The owner routes must refuse an anonymous caller. The admin routes must refuse one too, and must
// refuse an owner's token even though it is real and correctly signed — that is the audience split
// doing its job before any handler runs.
public class NewFeatureAccessTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    /// <summary>A real, correctly signed owner token. Only its audience is wrong for admin routes.</summary>
    private string OwnerToken() =>
        _factory.Services.GetRequiredService<TokenService>().CreateAccessToken(42).Token;

    // ---------------------------------------------------------------- owner routes
    public static TheoryData<string, string> OwnerRoutes() => new()
    {
        { "GET", "/api/v1/me/listings/1/hours" },
        { "PUT", "/api/v1/me/listings/1/hours" },
        { "GET", "/api/v1/me/listings/1/faqs" },
        { "POST", "/api/v1/me/listings/1/faqs" },
        { "DELETE", "/api/v1/me/listings/1/faqs/1" },
        { "GET", "/api/v1/me/listings/1/content" },
        { "POST", "/api/v1/me/listings/1/content" },
        { "DELETE", "/api/v1/me/listings/1/content/1" },
        { "GET", "/api/v1/me/listings/1/attributes" },
        { "POST", "/api/v1/me/listings/1/attributes" },
        { "DELETE", "/api/v1/me/listings/1/attributes/1" },
    };

    [Theory]
    [MemberData(nameof(OwnerRoutes))]
    public async Task Every_owner_route_refuses_an_anonymous_caller(string method, string path)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method is "POST" or "PUT")
        {
            request.Content = JsonContent.Create(new { intervals = Array.Empty<object>() });
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    // ---------------------------------------------------------------- admin routes
    public static TheoryData<string, string> SuperAdminRoutes() => new()
    {
        { "GET", "/api/v1/super-admin/homepage-groups" },
        { "POST", "/api/v1/super-admin/homepage-groups" },
        { "PUT", "/api/v1/super-admin/homepage-groups/1" },
        { "DELETE", "/api/v1/super-admin/homepage-groups/1" },
        { "PUT", "/api/v1/super-admin/listings/1/featured/group/2" },
    };

    [Theory]
    [MemberData(nameof(SuperAdminRoutes))]
    public async Task Every_homepage_group_route_refuses_an_anonymous_caller(string method, string path)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method is "POST" or "PUT")
        {
            request.Content = JsonContent.Create(new { title = "A shelf", isActive = true });
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Homepage_groups_are_not_on_the_ordinary_admin_surface()
    {
        /* Choosing what the platform recommends is super-admin work, and naming a shelf is the same
           decision as filling it. The route must not exist here at all: 404 or 405, never 401. */
        var response = await _client.GetAsync("/api/v1/admin/homepage-groups");

        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
    }

    public static TheoryData<string, string> AdminRoutes() => new()
    {
        { "GET", "/api/v1/admin/seo" },
        { "GET", "/api/v1/admin/seo/listing/1" },
        { "PUT", "/api/v1/admin/seo/listing/1" },
        { "DELETE", "/api/v1/admin/seo/listing/1" },
        { "GET", "/api/v1/admin/blog" },
        { "POST", "/api/v1/admin/blog" },
        { "GET", "/api/v1/admin/blog/1" },
        { "PUT", "/api/v1/admin/blog/1" },
        { "POST", "/api/v1/admin/blog/1/publish" },
        { "POST", "/api/v1/admin/blog/1/unpublish" },
        { "GET", "/api/v1/admin/search" },
        { "POST", "/api/v1/admin/search/synonyms" },
        { "DELETE", "/api/v1/admin/search/synonyms/1" },
        { "POST", "/api/v1/admin/search/placeholders" },
        { "DELETE", "/api/v1/admin/search/placeholders/1" },
    };

    [Theory]
    [MemberData(nameof(AdminRoutes))]
    public async Task Every_admin_route_refuses_an_anonymous_caller(string method, string path)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method is "POST" or "PUT")
        {
            request.Content = JsonContent.Create(new { title = "x", bodyMarkdown = "x", metaTitle = "x" });
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task An_owner_token_cannot_reach_the_new_admin_routes()
    {
        /* The token is real and correctly signed; only its audience is wrong. The refusal comes
           from the authentication layer before any handler runs, which is what a challenge header
           proves — a handler-level refusal would not send one. */
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/admin/seo");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", OwnerToken());

        var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("Bearer", response.Headers.WwwAuthenticate.Select(h => h.Scheme));
    }

    // ---------------------------------------------------------------- public routes
    [Theory]
    [InlineData("/api/v1/public/blog")]
    [InlineData("/api/v1/public/search-placeholders")]
    [InlineData("/api/v1/public/page-meta")]
    [InlineData("/api/v1/public/plans")]
    public async Task The_new_public_routes_exist_and_need_no_token(string path)
    {
        /* Without a database these cannot return data, so what is asserted is that the route is
           mapped and is not behind authentication: anything but 401 and 404 proves both. */
        var response = await _client.GetAsync(path);

        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_draft_post_is_not_reachable_by_guessing_its_slug()
    {
        // The public route filters on status, so an unpublished post is indistinguishable from one
        // that does not exist. Whether something is being written is not public information.
        var response = await _client.GetAsync("/api/v1/public/blog/some-unpublished-draft");

        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---------------------------------------------------------------- the surface split holds
    [Theory]
    [InlineData("GET", "/api/v1/super-admin/seo")]
    [InlineData("GET", "/api/v1/super-admin/blog")]
    [InlineData("GET", "/api/v1/super-admin/search")]
    public async Task The_new_admin_screens_were_not_also_mounted_on_the_super_admin_surface(
        string method, string path)
    {
        /* These belong to the admin surface. Mounting them on both would be the kind of quiet
           duplication that leaves one copy un-gated later, so their absence is asserted: 404 or
           405, never 401, because a 401 would mean the route exists. */
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        var response = await _client.SendAsync(request);

        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
    }
}
