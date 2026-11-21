using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// The length rules on a staff-written page override (S0021). How an override is *addressed* is
/// tested in <c>ListingContentValidationTests</c>; this is only about what fits.
///
/// <para>
/// These four fields used to be truncated to their column widths on the way to the database, so
/// nothing ever failed — it just stored something other than what was typed. That is the wrong
/// trade for these fields in particular: they are what a search engine reads and what a shared link
/// shows, and a title cut at 200 characters mid-word is published to exactly the audience the
/// override exists to impress, with nothing in the panel saying it happened.
/// </para>
/// </summary>
public class PageMetaValidationTests
{
    [Fact]
    public void Nothing_set_is_not_a_length_problem()
    {
        /* All four empty is refused by the handler's own rule — an override that sets nothing would
           shadow the page's derived metadata with emptiness — and that is a different message.
           Here it simply is not too long. */
        Assert.Null(AdminSeoEndpoints.ValidateMeta(null, null, null, null));
    }

    [Fact]
    public void Ordinary_values_pass()
    {
        Assert.Null(AdminSeoEndpoints.ValidateMeta(
            "Cafes in Madhapur | HYDERABAD LINKS",
            "Find cafes in Madhapur with addresses, phone numbers and opening hours.",
            "cafes, madhapur, hyderabad",
            "https://hyderabadlinks.com/og/cafes.png"));
    }

    [Fact]
    public void Every_field_exactly_at_its_limit_is_accepted()
    {
        Assert.Null(AdminSeoEndpoints.ValidateMeta(
            new string('t', AdminSeoEndpoints.MaxTitleLength),
            new string('d', AdminSeoEndpoints.MaxDescriptionLength),
            new string('k', AdminSeoEndpoints.MaxKeywordsLength),
            new string('u', AdminSeoEndpoints.MaxImageUrlLength)));
    }

    [Fact]
    public void A_title_over_the_limit_is_refused_rather_than_cut()
    {
        var errors = AdminSeoEndpoints.ValidateMeta(
            new string('t', AdminSeoEndpoints.MaxTitleLength + 1), null, null, null);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("metaTitle"));
    }

    [Fact]
    public void A_description_over_the_limit_is_refused()
    {
        var errors = AdminSeoEndpoints.ValidateMeta(
            null, new string('d', AdminSeoEndpoints.MaxDescriptionLength + 1), null, null);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("metaDescription"));
    }

    [Fact]
    public void Keywords_over_the_limit_are_refused()
    {
        var errors = AdminSeoEndpoints.ValidateMeta(
            null, null, new string('k', AdminSeoEndpoints.MaxKeywordsLength + 1), null);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("metaKeywords"));
    }

    [Fact]
    public void An_image_address_over_the_limit_is_refused()
    {
        var errors = AdminSeoEndpoints.ValidateMeta(
            null, null, null, new string('u', AdminSeoEndpoints.MaxImageUrlLength + 1));

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("ogImageUrl"));
    }

    [Fact]
    public void All_four_are_reported_together()
    {
        /* One form, four boxes. Reporting them one at a time would have an admin submitting four
           times to find out about four fields. */
        var errors = AdminSeoEndpoints.ValidateMeta(
            new string('t', AdminSeoEndpoints.MaxTitleLength + 1),
            new string('d', AdminSeoEndpoints.MaxDescriptionLength + 1),
            new string('k', AdminSeoEndpoints.MaxKeywordsLength + 1),
            new string('u', AdminSeoEndpoints.MaxImageUrlLength + 1));

        Assert.NotNull(errors);
        Assert.Equal(4, errors.Count);
    }

    [Fact]
    public void The_limits_match_the_columns()
    {
        Assert.Equal(200, AdminSeoEndpoints.MaxTitleLength);
        Assert.Equal(400, AdminSeoEndpoints.MaxDescriptionLength);
        Assert.Equal(400, AdminSeoEndpoints.MaxKeywordsLength);
        Assert.Equal(500, AdminSeoEndpoints.MaxImageUrlLength);
    }
}
