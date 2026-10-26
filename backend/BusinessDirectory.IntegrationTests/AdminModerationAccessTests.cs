using System.Net;
using System.Net.Http.Json;
using BusinessDirectory.Api.Auth;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace BusinessDirectory.IntegrationTests;

// Access control and request validation for the admin surface. Nothing here reaches the database:
// every assertion is about a request that must be refused before any SQL runs, which is why these
// tests pass in CI, where no database exists. SQL behaviour is checked by
// database/sqlserver/checks/admin_moderation_smoke.sql instead.
public class AdminModerationAccessTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    /// <summary>A genuine owner token, signed with the running app's own key.</summary>
    private string OwnerToken() => _factory.Services.GetRequiredService<TokenService>().CreateAccessToken(42).Token;

    private async Task<HttpResponseMessage> Send(HttpMethod method, string path, string? bearer = null, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (bearer is not null)
        {
            request.Headers.Authorization = new("Bearer", bearer);
        }
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }
        return await _client.SendAsync(request);
    }

    // ---------------------------------------------------------------- anonymous callers
    [Theory]
    [InlineData("GET", "/api/v1/admin/me")]
    [InlineData("GET", "/api/v1/admin/listings")]
    [InlineData("GET", "/api/v1/admin/listings?status=active")]
    [InlineData("GET", "/api/v1/admin/listings/1")]
    [InlineData("POST", "/api/v1/admin/listings/1/approve")]
    [InlineData("POST", "/api/v1/admin/listings/1/reject")]
    [InlineData("GET", "/api/v1/admin/categories")]
    [InlineData("POST", "/api/v1/admin/categories")]
    [InlineData("PUT", "/api/v1/admin/categories/1")]
    [InlineData("DELETE", "/api/v1/admin/categories/1")]
    [InlineData("GET", "/api/v1/admin/cities")]
    [InlineData("GET", "/api/v1/admin/localities")]
    [InlineData("POST", "/api/v1/admin/localities")]
    [InlineData("PUT", "/api/v1/admin/localities/1")]
    [InlineData("DELETE", "/api/v1/admin/localities/1")]
    public async Task Every_admin_route_refuses_an_anonymous_caller(string method, string path)
    {
        var response = await Send(new HttpMethod(method), path, body: new { name = "X" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_forged_token_is_refused()
    {
        var response = await Send(HttpMethod.Get, "/api/v1/admin/listings",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.invalidsignature");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---------------------------------------------------------------- the audience split
    [Theory]
    [InlineData("GET", "/api/v1/admin/me")]
    [InlineData("GET", "/api/v1/admin/listings")]
    [InlineData("GET", "/api/v1/admin/listings/1")]
    [InlineData("POST", "/api/v1/admin/listings/1/approve")]
    [InlineData("POST", "/api/v1/admin/listings/1/reject")]
    [InlineData("GET", "/api/v1/admin/categories")]
    [InlineData("POST", "/api/v1/admin/categories")]
    [InlineData("PUT", "/api/v1/admin/categories/1")]
    [InlineData("DELETE", "/api/v1/admin/categories/1")]
    [InlineData("GET", "/api/v1/admin/localities")]
    [InlineData("POST", "/api/v1/admin/localities")]
    public async Task A_valid_owner_token_is_refused_on_every_admin_route(string method, string path)
    {
        // The token is real and correctly signed; only its audience is wrong. Nothing reaches the
        // handler, so an owner can never moderate — or touch the taxonomy — with their session.
        var response = await Send(new HttpMethod(method), path, OwnerToken(), new { name = "X" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---------------------------------------------------------------- writing listings has moved
    [Theory]
    [InlineData("POST", "/api/v1/admin/listings")]
    [InlineData("PUT", "/api/v1/admin/listings/1")]
    [InlineData("DELETE", "/api/v1/admin/listings/1")]
    public async Task An_admin_cannot_write_a_listing_at_all(string method, string path)
    {
        /* These routes used to exist here. An admin reviews what owners submit; adding, correcting
           and removing a business is super-admin work on /api/v1/super-admin/listings. The route is
           gone rather than merely refused, so the answer is 404 or 405 and not 401 -- asserted
           explicitly, because a route quietly reappearing is exactly the regression that would put
           listing writes back on the admin surface. */
        var response = await Send(new HttpMethod(method), path, body: new { name = "X" });

        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
    }

    [Fact]
    public async Task An_owner_token_is_turned_away_by_authentication_not_by_a_handler()
    {
        // The refusal must come from the authentication layer, before any handler runs: that is what
        // proves the audience split is doing the work. A challenge header is only sent in that case.
        var response = await Send(HttpMethod.Get, "/api/v1/admin/listings", OwnerToken());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("Bearer", response.Headers.WwwAuthenticate.Select(h => h.Scheme));
    }

    // ---------------------------------------------------------------- sign-in validation
    [Theory]
    [InlineData("", "a long enough passphrase")]
    [InlineData("   ", "a long enough passphrase")]
    [InlineData("not-an-email", "a long enough passphrase")]
    [InlineData("admin@example.com", "")]
    public async Task Signing_in_with_an_unusable_email_or_password_is_refused(string email, string password)
    {
        var response = await Send(HttpMethod.Post, "/api/v1/auth/admin/login", body: new { email, password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Signing_in_without_a_body_is_rejected()
    {
        var response = await _client.PostAsync("/api/v1/auth/admin/login", null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task The_sign_in_failure_message_does_not_say_which_part_was_wrong()
    {
        var response = await Send(HttpMethod.Post, "/api/v1/auth/admin/login",
            body: new { email = "not-an-email", password = "a long enough passphrase" });
        var body = await response.Content.ReadAsStringAsync();

        Assert.Contains("incorrect", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("unknown", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("password_hash", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task There_is_no_admin_sign_up_endpoint()
    {
        // Admin accounts are invite-only; the first one is created by the command-line bootstrap.
        foreach (var path in new[] { "/api/v1/auth/admin/register", "/api/v1/auth/admin/signup", "/api/v1/admin/admins" })
        {
            var response = await _client.PostAsJsonAsync(path, new { email = "new@example.com" });
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
    }

    [Fact]
    public async Task Refreshing_without_a_token_is_unauthorised()
    {
        var response = await Send(HttpMethod.Post, "/api/v1/auth/admin/refresh", body: new { refreshToken = "" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Signing_out_without_a_token_says_nothing_either_way()
    {
        var response = await Send(HttpMethod.Post, "/api/v1/auth/admin/logout", body: new { refreshToken = "" });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    // ---------------------------------------------------------------- the admin site is never indexed
    [Fact]
    public async Task Admin_responses_are_not_cacheable()
    {
        var response = await Send(HttpMethod.Get, "/api/v1/admin/listings");

        Assert.Contains("no-store", response.Headers.GetValues("Cache-Control").Single());
    }
}
