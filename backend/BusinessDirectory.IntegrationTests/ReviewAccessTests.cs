using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BusinessDirectory.IntegrationTests;

// Writing a review needs a signed-in, phone-verified person (decision D11), and moderating one
// needs an admin token. Reading approved reviews is public.
//
// These run with no database, so only the authorization boundary is testable here. The rules that
// need real rows — owner cannot review their own business, one review per person, nothing public
// until approved, a decided review cannot be decided twice — were verified against the running API
// and are covered by database/sqlserver/checks/review_smoke.sql.
public class ReviewAccessTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Writing_a_review_requires_sign_in()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/customer/reviews/hyderabad/madhapur/some-business",
            new { rating = 5, body = "A perfectly reasonable review of adequate length." });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Listing_your_own_reviews_requires_sign_in() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/v1/customer/reviews")).StatusCode);

    [Theory]
    [InlineData("/api/v1/admin/reviews")]
    public async Task The_moderation_queue_refuses_an_anonymous_caller(string path) =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync(path)).StatusCode);

    [Fact]
    public async Task Moderating_a_review_refuses_an_anonymous_caller()
    {
        var approve = await _client.PostAsJsonAsync("/api/v1/admin/reviews/1/approve", new { });
        var reject = await _client.PostAsJsonAsync("/api/v1/admin/reviews/1/reject", new { note = "Spam" });

        Assert.Equal(HttpStatusCode.Unauthorized, approve.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, reject.StatusCode);
    }

    [Fact]
    public async Task An_owner_token_cannot_moderate_reviews()
    {
        // Owner and admin tokens carry different audiences, so neither works on the other's routes.
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/admin/reviews/1/approve")
        {
            Content = JsonContent.Create(new { }),
        };
        request.Headers.Add("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.not-a-real-signature");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }
}
