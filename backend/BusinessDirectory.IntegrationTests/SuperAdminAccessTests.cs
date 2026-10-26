using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BusinessDirectory.IntegrationTests;

// The super-admin surface has two gates: its own token audience, and a permission reserved for it.
// These run with no database, so what is testable here is that nothing reaches these routes without
// a super-admin token. That an ordinary administrator's token is refused even when the account holds
// the permission, and that a super-admin token is refused by /api/v1/admin, were both verified
// against the running API with two real accounts.
public class SuperAdminAccessTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    public static TheoryData<string> ReadRoutes() =>
    [
        "/api/v1/super-admin/me",
        "/api/v1/super-admin/overview",
        "/api/v1/super-admin/admins",
        "/api/v1/super-admin/roles",
        "/api/v1/super-admin/audit",
        "/api/v1/super-admin/listings",
        "/api/v1/super-admin/listings/1",
    ];

    [Theory]
    [MemberData(nameof(ReadRoutes))]
    public async Task Every_read_route_refuses_an_anonymous_caller(string route) =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync(route)).StatusCode);

    [Theory]
    [MemberData(nameof(ReadRoutes))]
    public async Task Every_read_route_refuses_a_made_up_token(string route)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, route);
        request.Headers.Add("Authorization", "Bearer not-a-real-token");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Changing_someones_roles_refuses_an_anonymous_caller()
    {
        var response = await _client.PutAsJsonAsync("/api/v1/super-admin/admins/1/roles", new { roles = new[] { "admin" } });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Changing_someones_status_refuses_an_anonymous_caller()
    {
        var response = await _client.PutAsJsonAsync("/api/v1/super-admin/admins/1/status", new { status = "disabled" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---------------------------------------------------------------- writing listings
    // These moved off /api/v1/admin, so the gate that used to be an admin token is now a
    // super-admin one. Anonymous must get nowhere near any of them.
    [Fact]
    public async Task Creating_a_listing_refuses_an_anonymous_caller()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/super-admin/listings", new { name = "X" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Editing_a_listing_refuses_an_anonymous_caller()
    {
        var response = await _client.PutAsJsonAsync("/api/v1/super-admin/listings/1", new { name = "X" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Archiving_a_listing_refuses_an_anonymous_caller() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.PostAsync("/api/v1/super-admin/listings/1/archive", null)).StatusCode);

    [Fact]
    public async Task Deleting_a_listing_refuses_an_anonymous_caller() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.DeleteAsync("/api/v1/super-admin/listings/1")).StatusCode);

    [Fact]
    public async Task Resetting_an_authenticator_refuses_an_anonymous_caller() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.PostAsync("/api/v1/super-admin/admins/1/reset-mfa", null)).StatusCode);
}
