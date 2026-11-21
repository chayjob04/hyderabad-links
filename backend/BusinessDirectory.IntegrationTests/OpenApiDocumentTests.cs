using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using BusinessDirectory.Api;

namespace BusinessDirectory.IntegrationTests;

// The OpenAPI document: that it is produced at all, that it describes every audience, and that it
// can be switched off.
//
// Worth testing rather than assumed, because the document is generated from the endpoint metadata at
// request time. A handler whose parameters cannot be described throws *while the document is being
// built*, long after a green `dotnet build` -- so a compiling API is no evidence that it can
// describe itself. `packages/api-client` is generated from this document, and a generator reads it
// once, in CI, on a machine nobody is watching.
//
// OpenApi:Enabled is set explicitly in both directions rather than relying on the test host's
// environment name, which WebApplicationFactory decides and which is not this suite's to depend on.
public class OpenApiDocumentTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string DocumentPath = "/openapi/v1.json";

    private HttpClient Client(bool published) => factory
        .WithWebHostBuilder(builder =>
            builder.UseSetting(ApiDescription.EnabledSetting, published ? "true" : "false"))
        .CreateClient();

    private async Task<JsonDocument> GetDocumentAsync()
    {
        var response = await Client(published: true).GetAsync(DocumentPath);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_document_is_served_and_is_valid_json()
    {
        using var document = await GetDocumentAsync();

        // The version matters to a generator: v2 and v3 documents are not read by the same tools.
        Assert.StartsWith("3.", document.RootElement.GetProperty("openapi").GetString());
    }

    [Fact]
    public async Task It_is_not_served_when_switched_off()
    {
        // Production's default. A 404, not an empty document: the route is simply not mapped.
        var response = await Client(published: false).GetAsync(DocumentPath);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task It_names_the_service_and_offers_a_bearer_scheme()
    {
        using var document = await GetDocumentAsync();

        var info = document.RootElement.GetProperty("info");
        Assert.Equal("HYDERABAD LINKS API", info.GetProperty("title").GetString());
        Assert.Equal("v1", info.GetProperty("version").GetString());

        var bearer = document.RootElement
            .GetProperty("components").GetProperty("securitySchemes").GetProperty("bearer");
        Assert.Equal("http", bearer.GetProperty("type").GetString());
        Assert.Equal("bearer", bearer.GetProperty("scheme").GetString());
    }

    [Theory]
    // Every audience group, so a group dropped out of Program.cs's endpoint list -- or one whose
    // handler cannot be described -- fails here rather than silently going missing from the
    // generated client. Asserted by prefix rather than by one named route, because a route that is
    // renamed is a normal change while an audience that vanishes is not.
    [InlineData("/api/v1/public/")]
    [InlineData("/api/v1/auth/owner/")]
    [InlineData("/api/v1/auth/customer/")]
    [InlineData("/api/v1/auth/admin/")]
    [InlineData("/api/v1/me")]
    [InlineData("/api/v1/customer/")]
    [InlineData("/api/v1/admin/")]
    [InlineData("/api/v1/super-admin/")]
    [InlineData("/api/v1/webhooks/")]
    public async Task It_describes_every_audience(string prefix)
    {
        using var document = await GetDocumentAsync();

        var described = document.RootElement.GetProperty("paths").EnumerateObject()
            .Any(path => path.Name.StartsWith(prefix, StringComparison.Ordinal));

        Assert.True(described, $"No path beginning {prefix} is in the OpenAPI document.");
    }

    [Fact]
    public async Task Every_operation_is_tagged_with_its_audience()
    {
        using var document = await GetDocumentAsync();

        var untagged = new List<string>();
        var tags = new HashSet<string>();

        foreach (var path in document.RootElement.GetProperty("paths").EnumerateObject())
        {
            foreach (var operation in path.Value.EnumerateObject())
            {
                if (!operation.Value.TryGetProperty("tags", out var operationTags)
                    || operationTags.GetArrayLength() != 1)
                {
                    untagged.Add($"{operation.Name.ToUpperInvariant()} {path.Name}");
                    continue;
                }

                tags.Add(operationTags[0].GetString()!);
            }
        }

        Assert.Empty(untagged);

        /* Every tag an operation uses must also be declared at the top of the document. A tag
           reference resolves its name against that list, so one that is missing would serialise
           without a usable name -- and a generator would produce a client grouped under nothing. */
        var declared = document.RootElement.GetProperty("tags").EnumerateArray()
            .Select(tag => tag.GetProperty("name").GetString()!)
            .ToHashSet();
        Assert.Empty(tags.Except(declared));

        // "Other" would mean a path outside every known audience prefix -- a new route group that
        // TagFor has not been told about, which is exactly the drift this guards against.
        Assert.DoesNotContain("Other", tags);
        Assert.Contains("Public", tags);
        Assert.Contains("Business owner", tags);
        Assert.Contains("Admin", tags);
        Assert.Contains("Super admin", tags);
    }

    [Theory]
    // The ordering in TagFor is load-bearing: /auth/admin is a sign-in, not part of the
    // administrative surface, and /super-admin starts with neither /admin nor a distinct prefix.
    [InlineData("/api/v1/public/listings", "Public")]
    [InlineData("/api/v1/auth/admin/login", "Sign in")]
    [InlineData("/api/v1/auth/customer/verify-code", "Sign in")]
    [InlineData("/api/v1/admin/listings", "Admin")]
    [InlineData("/api/v1/super-admin/admins", "Super admin")]
    [InlineData("/api/v1/me/listings", "Business owner")]
    [InlineData("/api/v1/customer/favourites", "Customer")]
    [InlineData("/api/v1/webhooks/razorpay", "Webhooks")]
    [InlineData("/health/ready", "Health")]
    public void A_path_is_tagged_by_the_audience_it_belongs_to(string path, string expected)
        => Assert.Equal(expected, ApiDescription.AudienceTags.TagFor(path));
}
