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

/// <summary>
/// Who may name a link (S0029).
///
/// Links themselves are unlimited on every plan now, and what the Verified plan sells is naming
/// them: a free listing's links are `Link 1`, `Link 2`, ..., and a paid one's are whatever the
/// owner calls them. That is the whole of the paid feature on this screen, so it is asserted
/// directly — getting it wrong either gives the feature away or refuses it to somebody who paid.
/// </summary>
public class LinkNamingTests
{
    [Fact]
    public void A_generic_label_is_the_position_counted_from_one()
    {
        // An owner reads "Link 1", not "Link 0": the slot is an index, the label is a position.
        Assert.Equal("Link 1", OwnerLinkEndpoints.GenericLabel(0));
        Assert.Equal("Link 2", OwnerLinkEndpoints.GenericLabel(1));
        Assert.Equal("Link 6", OwnerLinkEndpoints.GenericLabel(5));
    }

    [Fact]
    public void A_paid_listing_keeps_the_name_the_owner_typed()
    {
        Assert.Equal("Our menu", OwnerLinkEndpoints.LabelToStore(canNameLinks: true, "Our menu", slot: 3));
    }

    [Fact]
    public void A_free_listing_gets_the_position_whatever_it_submitted()
    {
        /* Not refused, ignored. The free form has no label field, so a 400 would be complaining
           about something the owner never filled in — and a crafted request should not be able to
           buy the paid feature either. */
        Assert.Equal("Link 4", OwnerLinkEndpoints.LabelToStore(canNameLinks: false, "Our menu", slot: 3));
        Assert.Equal("Link 1", OwnerLinkEndpoints.LabelToStore(canNameLinks: false, "", slot: 0));
    }

    [Fact]
    public void The_rule_follows_the_entitlement_rather_than_the_plan_name()
    {
        /* `canNameLinks` is read from listing_entitlements, which compares the subscription period
           against the clock — so a lapsed listing loses the right to rename on its next request
           while keeping every link it already saved. This test pins the shape of that: the only
           input is the boolean, with no plan slug anywhere in the signature. */
        Assert.Equal("Link 2", OwnerLinkEndpoints.LabelToStore(canNameLinks: false, "Renamed after lapsing", slot: 1));
    }
}

/// <summary>
/// What a visitor sees, which is not always what is stored.
///
/// A name chosen under Verified stays in the row when the plan lapses — deleting it would destroy
/// something the owner wrote — but it stops being *published*, because naming is what was paid for.
/// That is the same bargain `listing_visible_media` strikes with over-allowance photos (D10), and
/// these tests are the rule rather than the SQL that applies it to the public page.
/// </summary>
public class LinkDisplayLabelTests
{
    [Fact]
    public void A_paid_listing_publishes_the_name_its_owner_chose()
    {
        Assert.Equal("Our menu", OwnerLinkEndpoints.DisplayLabel(verified: true, "Our menu", position: 2));
    }

    [Fact]
    public void An_unpaid_listing_publishes_the_position_instead()
    {
        // The stored name is the input and is not the output: it survives, it is just not shown.
        Assert.Equal("Link 3", OwnerLinkEndpoints.DisplayLabel(verified: false, "Our menu", position: 2));
    }

    [Fact]
    public void The_number_is_the_position_in_the_list_not_the_slot()
    {
        /* `sort_order` has gaps once a link has been deleted — 0, 1, 3 is an ordinary state. A
           visitor must still read Link 1, Link 2, Link 3 with nothing missing, so the caller passes
           the position in the rendered list and this counts from that. */
        Assert.Equal("Link 1", OwnerLinkEndpoints.DisplayLabel(verified: false, "anything", position: 0));
        Assert.Equal("Link 2", OwnerLinkEndpoints.DisplayLabel(verified: false, "anything", position: 1));
        Assert.Equal("Link 3", OwnerLinkEndpoints.DisplayLabel(verified: false, "anything", position: 2));
    }

    [Fact]
    public void A_free_listing_that_never_named_anything_reads_the_same_either_way()
    {
        // Its stored label already *is* the position, so the two agree and nothing looks renamed.
        Assert.Equal("Link 2", OwnerLinkEndpoints.DisplayLabel(verified: false, "Link 2", position: 1));
    }
}

/// <summary>
/// The legacy `limit` number the links response still carries.
///
/// The API, the migration and three websites deploy independently, so for a while an older website
/// is reading this field while a newer API answers it. `null` would arrive there as 0 and make a
/// paid listing look full at its first link, so the number is kept truthful on both schemas
/// instead. See <c>LinkAllowanceDto.Limit</c> for when it can be deleted.
/// </summary>
public class LinkLegacyLimitTests
{
    [Fact]
    public void While_the_database_still_has_a_cap_that_is_the_number_reported()
    {
        // Before S0029: the view says 5 for a paid listing and 0 for a free one, and it is real.
        Assert.Equal(5, OwnerLinkEndpoints.LegacyLimit(schemaLimit: 5, verified: true));
        Assert.Equal(0, OwnerLinkEndpoints.LegacyLimit(schemaLimit: 0, verified: false));
    }

    [Fact]
    public void Once_the_cap_is_gone_the_old_derived_value_is_reported()
    {
        /* After S0029 the view says NULL. An older website cannot render that, so it is told what
           the old API would have told it — which keeps its "{used} of {limit}" line sensible until
           it is replaced by one that reads `unlimited`. */
        Assert.Equal(5, OwnerLinkEndpoints.LegacyLimit(schemaLimit: null, verified: true));
        Assert.Equal(0, OwnerLinkEndpoints.LegacyLimit(schemaLimit: null, verified: false));
    }

    [Fact]
    public void A_cap_of_zero_is_not_mistaken_for_no_cap()
    {
        /* The distinction this whole function exists for: 0 is "this plan includes none", NULL is
           "there is no limit". Collapsing them would either refuse every link on the new schema or
           accept a sixth on the old one. */
        Assert.Equal(0, OwnerLinkEndpoints.LegacyLimit(schemaLimit: 0, verified: true));
    }
}
