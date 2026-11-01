using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// The shared link validator.
///
/// It was private to the owner's own screen until the staff editor needed the same rule
/// (SuperAdminListingContentEndpoints), and it is the one rule on a listing page whose output
/// becomes an href a visitor's browser will follow. These tests exist so the extraction cannot
/// quietly loosen it.
/// </summary>
public class LinkNormalisationTests
{
    private static OwnerLinkEndpoints.AddLinkRequest Request(
        string? type = "website", string? label = "Our site", string? url = "https://example.com") =>
        new(type, label, url);

    [Fact]
    public void A_good_link_is_accepted_and_trimmed()
    {
        var ok = OwnerLinkEndpoints.TryNormalise(
            Request(type: "  Website  ", label: "  Our site  ", url: "  https://example.com/shop  "),
            out var link,
            out var errors);

        Assert.True(ok);
        Assert.Empty(errors);
        Assert.Equal("website", link.LinkType); // lower-cased, so listing_links_type_check accepts it
        Assert.Equal("Our site", link.Label);
        Assert.Equal("https://example.com/shop", link.Url);
    }

    [Theory]
    [InlineData("website")]
    [InlineData("instagram")]
    [InlineData("facebook")]
    [InlineData("youtube")]
    [InlineData("linkedin")]
    [InlineData("x")]
    [InlineData("other")]
    public void Every_type_the_database_allows_is_accepted(string type)
    {
        // If these drift from listing_links_type_check, the database refuses with a constraint name
        // and the owner sees an error nobody can act on.
        Assert.True(OwnerLinkEndpoints.TryNormalise(Request(type: type), out _, out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("tiktok")]
    [InlineData("WEBSITE ")]  // trimmed and lower-cased first, so this one is actually fine
    public void An_unknown_type_is_refused(string? type)
    {
        var ok = OwnerLinkEndpoints.TryNormalise(Request(type: type), out _, out var errors);

        if (type == "WEBSITE ")
        {
            Assert.True(ok);
            return;
        }

        Assert.False(ok);
        Assert.Contains("linkType", errors.Keys);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("JavaScript:alert(1)")]
    [InlineData("data:text/html,<script>alert(1)</script>")]
    [InlineData("vbscript:msgbox(1)")]
    [InlineData("file:///etc/passwd")]
    [InlineData("ftp://example.com")]
    // Not a URL at all, and the shape a parser is likeliest to let through.
    [InlineData("https:/example.com")]
    [InlineData("example.com")]
    [InlineData("//example.com")]
    public void Anything_that_is_not_http_or_https_is_refused(string url)
    {
        var ok = OwnerLinkEndpoints.TryNormalise(Request(url: url), out _, out var errors);

        Assert.False(ok);
        Assert.Contains("url", errors.Keys);
    }

    [Fact]
    public void Plain_http_is_accepted()
    {
        // Not every small business has TLS. Refusing http would quietly drop their only web address.
        Assert.True(OwnerLinkEndpoints.TryNormalise(Request(url: "http://example.com"), out _, out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_label_is_refused(string? label)
    {
        var ok = OwnerLinkEndpoints.TryNormalise(Request(label: label), out _, out var errors);

        Assert.False(ok);
        Assert.Contains("label", errors.Keys);
    }

    [Fact]
    public void An_over_long_label_is_refused()
    {
        var ok = OwnerLinkEndpoints.TryNormalise(
            Request(label: new string('a', 81)), out _, out var errors);

        Assert.False(ok);
        Assert.Contains("label", errors.Keys);
    }

    [Fact]
    public void A_label_at_the_limit_is_accepted()
    {
        Assert.True(OwnerLinkEndpoints.TryNormalise(Request(label: new string('a', 80)), out _, out _));
    }

    [Fact]
    public void An_over_long_url_is_refused()
    {
        var url = "https://example.com/" + new string('a', 1000);

        var ok = OwnerLinkEndpoints.TryNormalise(Request(url: url), out _, out var errors);

        Assert.False(ok);
        Assert.Contains("url", errors.Keys);
    }

    [Fact]
    public void Every_bad_field_is_reported_at_once()
    {
        // One round trip, not three: an owner should not have to resubmit to find the next problem.
        var ok = OwnerLinkEndpoints.TryNormalise(
            Request(type: "tiktok", label: "", url: "javascript:alert(1)"), out _, out var errors);

        Assert.False(ok);
        Assert.Equal(3, errors.Count);
    }

    [Fact]
    public void A_missing_body_is_refused_rather_than_throwing()
    {
        // The request body is bound from JSON and can legitimately arrive null.
        var ok = OwnerLinkEndpoints.TryNormalise(null, out _, out var errors);

        Assert.False(ok);
        Assert.NotEmpty(errors);
    }
}
