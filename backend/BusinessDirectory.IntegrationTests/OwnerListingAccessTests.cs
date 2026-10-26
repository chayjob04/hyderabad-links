using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BusinessDirectory.IntegrationTests;

// Every owner-listing route must refuse anonymous callers. No database is needed to prove that.
public class OwnerListingAccessTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Listing_list_requires_sign_in() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/v1/me/listings")).StatusCode);

    [Fact]
    public async Task Listing_detail_requires_sign_in() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/v1/me/listings/1")).StatusCode);

    [Fact]
    public async Task Creating_a_listing_requires_sign_in() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PostAsJsonAsync("/api/v1/me/listings", new { name = "X" })).StatusCode);

    [Fact]
    public async Task Editing_a_listing_requires_sign_in() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PutAsJsonAsync("/api/v1/me/listings/1", new { name = "X" })).StatusCode);

    [Fact]
    public async Task Submitting_a_listing_requires_sign_in() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PostAsync("/api/v1/me/listings/1/submit", null)).StatusCode);

    [Fact]
    public async Task Reading_the_alerts_on_a_listing_requires_sign_in() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/v1/me/listings/1/alerts")).StatusCode);

    [Fact]
    public async Task Acknowledging_an_alert_requires_sign_in() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.PostAsync("/api/v1/me/listings/1/alerts/1/acknowledge", null)).StatusCode);
}
