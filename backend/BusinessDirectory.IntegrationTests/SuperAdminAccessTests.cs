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
        "/api/v1/super-admin/listings/featured",
        "/api/v1/super-admin/listings/1/alerts",
        // Subscription management: who is paying and until when. Read-only, and super-admin only --
        // what every business pays is not moderation work.
        "/api/v1/super-admin/subscriptions",
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

    [Fact]
    public async Task Subscriptions_are_not_on_the_ordinary_admin_surface()
    {
        /* Seeing every business's plan and every payment taken is platform-owner work, gated on
           plans.manage, which the admin role does not hold. The route must not exist on the admin
           surface at all: 404 or 405, never 401, because a 401 would mean it is there. */
        var response = await _client.GetAsync("/api/v1/admin/subscriptions");

        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
    }

    [Fact]
    public async Task The_subscription_collection_itself_is_read_only()
    {
        /* Granting, extending, moving and ending a period are all per-listing routes (S0033). The
           collection takes no writes at all, so a POST to it is a mistake rather than a dangerous
           shortcut -- and this is what notices if one is ever added here instead. */
        foreach (var method in new[] { "POST", "PUT", "PATCH", "DELETE" })
        {
            using var request = new HttpRequestMessage(new HttpMethod(method), "/api/v1/super-admin/subscriptions");
            request.Content = JsonContent.Create(new { planSlug = "verified" });

            var response = await _client.SendAsync(request);

            Assert.Contains(
                response.StatusCode,
                new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
        }
    }

    public static TheoryData<string> SubscriptionWriteRoutes() =>
    [
        "/api/v1/super-admin/subscriptions/1/grant",
        "/api/v1/super-admin/subscriptions/1/extend",
        "/api/v1/super-admin/subscriptions/1/plan",
        "/api/v1/super-admin/subscriptions/1/revoke",
    ];

    [Theory]
    [MemberData(nameof(SubscriptionWriteRoutes))]
    public async Task Granting_or_ending_a_subscription_refuses_an_anonymous_caller(string route)
    {
        /* These give away a paid plan or take one back, so they are behind the super-admin audience
           and plans.manage. The refusal has to come before the handler: a 404 here would mean the
           route is missing, and anything else would mean it ran. */
        var response = await _client.PostAsJsonAsync(
            route, new { planSlug = "verified", months = 12, reason = "testing" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(SubscriptionWriteRoutes))]
    public async Task Granting_or_ending_a_subscription_is_not_on_the_admin_surface(string route)
    {
        // The same path under /api/v1/admin must not exist: 404 or 405, never 401.
        var response = await _client.PostAsJsonAsync(
            route.Replace("super-admin", "admin", StringComparison.Ordinal),
            new { planSlug = "verified", months = 12, reason = "testing" });

        Assert.Contains(
            response.StatusCode,
            new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
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
    public async Task Featuring_a_listing_refuses_an_anonymous_caller() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.PutAsync("/api/v1/super-admin/listings/1/featured", null)).StatusCode);

    [Fact]
    public async Task Unfeaturing_a_listing_refuses_an_anonymous_caller() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.DeleteAsync("/api/v1/super-admin/listings/1/featured")).StatusCode);

    [Fact]
    public async Task Sending_an_owner_an_alert_refuses_an_anonymous_caller()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/super-admin/listings/1/alerts",
            new { reason = "incorrect_details", message = "The phone number rings a different shop." });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Resetting_an_authenticator_refuses_an_anonymous_caller() =>
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await _client.PostAsync("/api/v1/super-admin/admins/1/reset-mfa", null)).StatusCode);
}
