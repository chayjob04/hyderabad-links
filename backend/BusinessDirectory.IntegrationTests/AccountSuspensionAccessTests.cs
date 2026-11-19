using System.Net;
using System.Security.Cryptography;
using BusinessDirectory.Api.Auth;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BusinessDirectory.IntegrationTests;

/// <summary>
/// The suspension fix added an endpoint filter to both public route groups
/// (<c>/api/v1/me</c> and <c>/api/v1/customer</c>), so that a suspended owner or customer is
/// refused on every route instead of keeping full access until their access token expires.
///
/// <para>
/// A filter on a group is easy to get wrong in a way no compiler sees: ordered before
/// authentication it would run for anonymous callers and hide a 401 behind a database error, and
/// attached to the wrong builder it would silently cover nothing. These tests assert the boundary
/// is still exactly where it was — every route refuses an anonymous caller and a wrongly-signed
/// token with 401, and never reaches a handler, which is also why they need no database.
/// </para>
/// <para>
/// What a suspended account actually sees is asserted against real rows in
/// <c>database/sqlserver/checks/account_suspension_smoke.sql</c>, because this suite deliberately
/// has no database (CLAUDE.md).
/// </para>
/// </summary>
public class AccountSuspensionAccessTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    /// <summary>A well-formed token for the right audience, signed with a key the API does not have.</summary>
    private static string ForeignToken(string audience)
    {
        var settings = new AuthSettings
        {
            JwtKey = RandomNumberGenerator.GetBytes(32),
            OtpKey = RandomNumberGenerator.GetBytes(32),
            TotpKey = RandomNumberGenerator.GetBytes(TotpSecrets.KeyBytes),
        };
        var service = new TokenService(settings);
        return audience == AuthSettings.CustomerAudience
            ? service.CreateCustomerAccessToken(1).Token
            : service.CreateAccessToken(1).Token;
    }

    public static TheoryData<string> OwnerRoutes => new()
    {
        "/api/v1/me",
        "/api/v1/me/listings",
        "/api/v1/me/enquiries",
        "/api/v1/me/overview",
    };

    public static TheoryData<string> CustomerRoutes => new()
    {
        "/api/v1/customer",
        "/api/v1/customer/favourites",
        "/api/v1/customer/reviews",
    };

    [Theory]
    [MemberData(nameof(OwnerRoutes))]
    public async Task An_owner_route_still_refuses_an_anonymous_caller(string path) =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync(path)).StatusCode);

    [Theory]
    [MemberData(nameof(CustomerRoutes))]
    public async Task A_customer_route_still_refuses_an_anonymous_caller(string path) =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync(path)).StatusCode);

    // The filter must run after authentication. If it ran before, this request would reach the
    // database with an unusable connection string and answer 500 instead of 401.
    [Theory]
    [MemberData(nameof(OwnerRoutes))]
    public async Task An_owner_route_refuses_a_foreign_token_before_any_lookup(string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Authorization", $"Bearer {ForeignToken(AuthSettings.OwnerAudience)}");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Theory]
    [MemberData(nameof(CustomerRoutes))]
    public async Task A_customer_route_refuses_a_foreign_token_before_any_lookup(string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Authorization", $"Bearer {ForeignToken(AuthSettings.CustomerAudience)}");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    // The sign-in routes are deliberately outside the filtered groups: a suspended owner must still
    // be able to end their session, and refresh has its own status check in SessionStore.Rotate.
    // Anonymous here means "no bearer token", which these endpoints never required.
    [Fact]
    public async Task Logging_out_is_not_behind_the_active_account_filter()
    {
        var response = await _client.PostAsync("/api/v1/auth/owner/logout", content: null);

        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
