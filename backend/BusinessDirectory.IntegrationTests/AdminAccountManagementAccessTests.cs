using System.Net;
using System.Net.Http.Json;

using Microsoft.AspNetCore.Mvc.Testing;

namespace BusinessDirectory.IntegrationTests;

/// <summary>
/// The authorization boundary around Admin Account Management.
///
/// Every route that creates, edits, resets or revokes must be unreachable without a super-admin
/// token, and the self-service password change must be unreachable without an admin one. These run
/// with no database: a 401 proves the request never reached a handler, which is exactly the claim
/// being made. The rules that need real rows — duplicate emails, the last-super-admin guard, the
/// audit entries — are in database/sqlserver/checks/admin_management_smoke.sql.
/// </summary>
public class AdminAccountManagementAccessTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    public static TheoryData<string> SuperAdminGets => new()
    {
        "/api/v1/super-admin/admins",
        "/api/v1/super-admin/admins/summary",
        "/api/v1/super-admin/admins/page",
        "/api/v1/super-admin/admins/1",
    };

    [Theory]
    [MemberData(nameof(SuperAdminGets))]
    public async Task Reading_admin_accounts_refuses_an_anonymous_caller(string path) =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync(path)).StatusCode);

    [Fact]
    public async Task Creating_an_admin_refuses_an_anonymous_caller()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/super-admin/admins", new
        {
            email = "someone@example.com",
            displayName = "Someone",
            password = "a-reasonable-passphrase",
            confirmPassword = "a-reasonable-passphrase",
            role = "admin",
        });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Editing_an_admin_refuses_an_anonymous_caller()
    {
        var response = await _client.PutAsJsonAsync(
            "/api/v1/super-admin/admins/1",
            new { email = "someone@example.com", displayName = "Someone" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Resetting_a_password_refuses_an_anonymous_caller()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/super-admin/admins/1/password",
            new { password = "a-reasonable-passphrase", confirmPassword = "a-reasonable-passphrase" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Revoking_sessions_refuses_an_anonymous_caller()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/super-admin/admins/1/revoke-sessions", new { });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// The self-service change is on the admin surface and needs no permission, but it still needs
    /// a session: without one it must not be reachable at all.
    /// </summary>
    [Fact]
    public async Task Changing_your_own_password_refuses_an_anonymous_caller()
    {
        var post = await _client.PostAsJsonAsync("/api/v1/admin/me/password", new
        {
            currentPassword = "whatever-it-was",
            newPassword = "a-reasonable-passphrase",
            confirmPassword = "a-reasonable-passphrase",
        });
        var get = await _client.GetAsync("/api/v1/admin/me/password");

        Assert.Equal(HttpStatusCode.Unauthorized, post.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, get.StatusCode);
    }

    /// <summary>
    /// An owner token must not reach the staff surface, and the account-management routes are no
    /// exception. The token is signed with a key the API does not have, so it fails before the
    /// audience is even considered — which is the point: nothing here lets an unauthenticated
    /// caller through, whatever they present.
    /// </summary>
    [Theory]
    [MemberData(nameof(SuperAdminGets))]
    public async Task Admin_account_routes_refuse_a_foreign_token(string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.not-a-real-signature");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(request)).StatusCode);
    }

    /// <summary>
    /// The super-admin account routes must not appear on the ordinary admin surface: managing
    /// administrators is super-admin work, and a route answering on /api/v1/admin would be a way
    /// around the audience split entirely.
    /// </summary>
    [Theory]
    [InlineData("/api/v1/admin/admins")]
    [InlineData("/api/v1/admin/admins/summary")]
    public async Task Admin_management_is_not_mounted_on_the_admin_surface(string path) =>
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync(path)).StatusCode);
}
