using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BusinessDirectory.IntegrationTests;

// A listing's media is a business's own property: nobody signed out may read it, add to it or
// remove it. These run with no database, so the authorization boundary is what is testable here.
// Ownership, the plan allowances and the magic-byte check were verified against the running API with
// a storage account, and the storage rules are in database/sqlserver/checks/media_smoke.sql.
public class OwnerMediaAccessTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Listing_media_requires_sign_in() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/v1/me/listings/1/media")).StatusCode);

    [Fact]
    public async Task Uploading_requires_sign_in()
    {
        using var body = new MultipartFormDataContent { { new StringContent("photo"), "kind" } };

        var response = await _client.PostAsync("/api/v1/me/listings/1/media", body);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Reordering_requires_sign_in() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.PostAsync("/api/v1/me/listings/1/media/1/move?direction=up", null)).StatusCode);

    [Fact]
    public async Task Deleting_requires_sign_in() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.DeleteAsync("/api/v1/me/listings/1/media/1")).StatusCode);

    [Fact]
    public async Task A_made_up_token_does_not_open_a_listings_media()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me/listings/1/media");
        request.Headers.Add("Authorization", "Bearer not-a-real-token");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task The_upload_route_rejects_an_unauthenticated_caller_before_reading_the_body()
    {
        // A signed-out caller must not be able to make the server buffer a large upload at all.
        using var body = new MultipartFormDataContent();
        body.Add(new ByteArrayContent(new byte[1024 * 1024]), "file", "big.jpg");

        var response = await _client.PostAsync("/api/v1/me/listings/1/media", body);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
