using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using BusinessDirectory.Api.Auth;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BusinessDirectory.IntegrationTests;

/// <summary>
/// The boundary between the two public realms, asserted on the running endpoint map rather than on
/// a unit of code: a customer token must not reach an owner route, and an owner token must not
/// reach a customer route.
///
/// Both tokens are signed with the same key and hold nothing but a subject id, so the only thing
/// keeping them apart is the audience, validated by a scheme that the policy pins. Registering the
/// customer scheme as a second *default* handler, or forgetting
/// <c>AddAuthenticationSchemes</c> on the policy, would quietly make either token work on both
/// sides. That mistake is invisible to the type system and to every other test in this suite.
///
/// These run with no database. They stop at the authorization boundary, which is the point: a 401
/// proves the request never reached a handler, so nothing had to connect.
/// </summary>
public class CustomerAccessTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    /// <summary>
    /// A syntactically valid token signed with a key the API does not have. It is refused for the
    /// signature, before the audience is even looked at, which is all these tests need: the point
    /// is that no route lets an unauthenticated caller through, whatever they present.
    /// </summary>
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

    public static TheoryData<string> CustomerGets => new()
    {
        "/api/v1/customer",
        "/api/v1/customer/favourites",
        "/api/v1/customer/reviews",
    };

    [Theory]
    [MemberData(nameof(CustomerGets))]
    public async Task Customer_routes_refuse_an_anonymous_caller(string path) =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync(path)).StatusCode);

    [Theory]
    [MemberData(nameof(CustomerGets))]
    public async Task Customer_routes_refuse_an_owner_token(string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Authorization", $"Bearer {ForeignToken(AuthSettings.OwnerAudience)}");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Saving_and_forgetting_a_favourite_refuses_an_anonymous_caller()
    {
        const string path = "/api/v1/customer/favourites/hyderabad/madhapur/some-business";

        var save = await _client.PutAsync(path, content: null);
        var forget = await _client.DeleteAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, save.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, forget.StatusCode);
    }

    [Fact]
    public async Task Editing_the_customer_profile_refuses_an_anonymous_caller()
    {
        var response = await _client.PutAsJsonAsync(
            "/api/v1/customer/profile",
            new { name = "A Customer", email = "someone@example.com" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// The mirror image, and the one that matters most: the owner dashboard must not open to a
    /// customer. /api/v1/me is the whole business surface — listings, enquiries, subscriptions.
    /// </summary>
    [Theory]
    [InlineData("/api/v1/me")]
    [InlineData("/api/v1/me/listings")]
    [InlineData("/api/v1/me/enquiries")]
    [InlineData("/api/v1/me/overview")]
    public async Task Owner_routes_refuse_a_customer_token(string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Authorization", $"Bearer {ForeignToken(AuthSettings.CustomerAudience)}");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Theory]
    [InlineData("/api/v1/admin/listings")]
    [InlineData("/api/v1/super-admin/admins")]
    public async Task Staff_routes_refuse_a_customer_token(string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Authorization", $"Bearer {ForeignToken(AuthSettings.CustomerAudience)}");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    /// <summary>
    /// The customer sign-in exists and is anonymous, like the owner one. A 400 (or 429) means the
    /// route is mapped and reached the handler's own validation; a 404 would mean it is not there.
    /// </summary>
    [Fact]
    public async Task The_customer_sign_in_is_mapped_and_open()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/customer/otp/request", new { phone = "not-a-number" });

        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Favourites_are_no_longer_on_the_owner_surface()
    {
        // They moved to /api/v1/customer with the identity split. Nothing should answer here.
        var response = await _client.GetAsync("/api/v1/me/favourites");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
