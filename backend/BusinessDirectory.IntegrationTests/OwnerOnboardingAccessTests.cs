using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BusinessDirectory.IntegrationTests;

// Onboarding must never be reachable without a verified owner token, because it is what turns a
// verified phone into an account. Like the other integration tests here, this needs no database.
// The behaviour that needs real rows (one account per owner, idempotent repeats, concurrent
// submits) is covered by database/sqlserver/checks/onboarding_smoke.sql.
public class OwnerOnboardingAccessTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private const string Onboarding = "/api/v1/me/onboarding";

    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Onboarding_requires_sign_in()
    {
        var response = await _client.PostAsJsonAsync(Onboarding, new
        {
            name = "Ramesh Kumar",
            email = "ramesh@example.com",
            businessName = "Ramesh Plumbing",
            localitySlug = "kukatpally",
            categorySlug = "plumbers",
        });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task An_anonymous_caller_is_refused_before_any_validation_runs()
    {
        // Entirely invalid input must still answer 401, not 400: an anonymous caller should learn
        // nothing about which fields exist or what they must look like.
        var response = await _client.PostAsJsonAsync(Onboarding, new { name = "", email = "nope" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /* S0032: asking for an area or a category that does not exist. It writes a row keyed to the
       caller, so it is behind the owner token like everything else under /api/v1/me. */
    [Fact]
    public async Task Asking_for_an_area_refuses_an_anonymous_caller()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/me/taxonomy-suggestions",
            new { kind = "locality", name = "Nallagandla" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
