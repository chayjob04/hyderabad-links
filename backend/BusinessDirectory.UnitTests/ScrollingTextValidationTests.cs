using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// The validation on the scrolling strip (S0025).
///
/// The link rule carries most of the weight here, and it is the reason this file exists. A line is
/// typed into the admin panel and rendered as a link on every public page, so an unchecked value
/// would be an open redirect — and a `javascript:` URL — reachable by anyone who can edit the
/// strip. Only a site-relative path is accepted, and these tests pin that down rather than trusting
/// the single `StartsWith` that implements it.
/// </summary>
public class ScrollingTextValidationTests
{
    // ---- the message ---------------------------------------------------------------------------

    [Fact]
    public void Message_is_trimmed()
    {
        var (message, error) = AdminHomepageEndpoints.NormaliseMessage("  Eid offers across Old City  ");

        Assert.Null(error);
        Assert.Equal("Eid offers across Old City", message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void Blank_message_is_refused(string? raw)
    {
        var (message, error) = AdminHomepageEndpoints.NormaliseMessage(raw);

        Assert.Null(message);
        Assert.NotNull(error);
    }

    [Fact]
    public void Message_at_the_limit_is_accepted()
    {
        var raw = new string('a', AdminHomepageEndpoints.MaxMessageLength);

        var (message, error) = AdminHomepageEndpoints.NormaliseMessage(raw);

        Assert.Null(error);
        Assert.Equal(raw, message);
    }

    [Fact]
    public void Message_over_the_limit_is_refused()
    {
        var raw = new string('a', AdminHomepageEndpoints.MaxMessageLength + 1);

        var (message, error) = AdminHomepageEndpoints.NormaliseMessage(raw);

        Assert.Null(message);
        Assert.NotNull(error);
    }

    /// <summary>The limit has to match `scrolling_texts.message`, or the database refuses what this accepts.</summary>
    [Fact]
    public void Message_limit_matches_the_column()
    {
        Assert.Equal(200, AdminHomepageEndpoints.MaxMessageLength);
    }

    // ---- the link ------------------------------------------------------------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void No_link_is_allowed(string? raw)
    {
        // An announcement with nowhere to go is a legitimate line, so this is not an error.
        var (url, error) = AdminHomepageEndpoints.NormaliseUrl(raw);

        Assert.Null(url);
        Assert.Null(error);
    }

    [Theory]
    [InlineData("/verified", "/verified")]
    [InlineData("  /trending  ", "/trending")]
    [InlineData("/search?q=biryani", "/search?q=biryani")]
    [InlineData("/food/restaurants", "/food/restaurants")]
    public void A_site_relative_path_is_accepted(string raw, string expected)
    {
        var (url, error) = AdminHomepageEndpoints.NormaliseUrl(raw);

        Assert.Null(error);
        Assert.Equal(expected, url);
    }

    [Theory]
    // A scheme, in the shapes that actually get used.
    [InlineData("javascript:alert(1)")]
    [InlineData("JavaScript:alert(1)")]
    [InlineData("data:text/html,<script>alert(1)</script>")]
    [InlineData("vbscript:msgbox(1)")]
    [InlineData("https://evil.example/phish")]
    [InlineData("http://evil.example")]
    // Protocol-relative: a browser reads this as another host, not as a path. It starts with "/",
    // which is exactly why the rule checks for a *single* one.
    [InlineData("//evil.example")]
    [InlineData("///evil.example")]
    // Not a path at all.
    [InlineData("verified")]
    [InlineData("../admin")]
    [InlineData("/")]
    public void Anything_that_is_not_a_site_path_is_refused(string raw)
    {
        var (url, error) = AdminHomepageEndpoints.NormaliseUrl(raw);

        Assert.Null(url);
        Assert.NotNull(error);
    }

    [Fact]
    public void Link_over_the_limit_is_refused()
    {
        var raw = "/" + new string('a', AdminHomepageEndpoints.MaxUrlLength);

        var (url, error) = AdminHomepageEndpoints.NormaliseUrl(raw);

        Assert.Null(url);
        Assert.NotNull(error);
    }

    [Fact]
    public void Link_limit_matches_the_column()
    {
        Assert.Equal(300, AdminHomepageEndpoints.MaxUrlLength);
    }

    /// <summary>
    /// The refusal has to say what a valid link looks like. An admin who has just pasted a full URL
    /// needs to be told to use a path, not simply that the thing they typed was wrong.
    /// </summary>
    [Fact]
    public void Refusal_explains_what_is_wanted()
    {
        var (_, error) = AdminHomepageEndpoints.NormaliseUrl("https://evil.example");

        Assert.NotNull(error);
        Assert.Contains("path", error, StringComparison.OrdinalIgnoreCase);
    }
}
