using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.UnitTests;

// The rule that decides whether saving a listing sends it to a moderator. It is shared by three
// paths -- creating, editing and the older submit endpoint -- and the reason it is shared is that
// they must agree: a listing that reaches the queue by one route and would have been refused by
// another leaves a moderator looking at a blank address with no way to know why.
public class ListingReadinessTests
{
    private const string GoodAddress = "12-3-45 Road No. 1, Banjara Hills";
    private const string GoodDescription = "Family dental clinic open seven days a week.";

    [Fact]
    public void A_complete_listing_is_ready()
    {
        Assert.True(ListingReadiness.IsReadyForReview(GoodAddress, GoodDescription));
        Assert.Empty(ListingReadiness.MissingForReview(GoodAddress, GoodDescription));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void An_address_that_is_absent_or_blank_is_missing(string? address)
    {
        var missing = ListingReadiness.MissingForReview(address, GoodDescription);

        Assert.Contains("addressLine", missing.Keys);
        Assert.DoesNotContain("description", missing.Keys);
    }

    [Fact]
    public void A_description_shorter_than_the_minimum_is_missing()
    {
        var missing = ListingReadiness.MissingForReview(GoodAddress, "Dentist");

        Assert.Contains("description", missing.Keys);
    }

    [Fact]
    public void Whitespace_does_not_count_towards_the_description_length()
    {
        // Twenty spaces would otherwise pass a naive length check and reach a moderator as blank.
        var padded = new string(' ', ListingReadiness.MinimumDescriptionLength + 5);

        Assert.False(ListingReadiness.IsReadyForReview(GoodAddress, padded));
    }

    [Fact]
    public void A_description_exactly_at_the_minimum_is_accepted()
    {
        // The boundary, stated: the rule is "at least", not "more than".
        var exact = new string('x', ListingReadiness.MinimumDescriptionLength);

        Assert.True(ListingReadiness.IsReadyForReview(GoodAddress, exact));
    }

    [Fact]
    public void Everything_missing_is_reported_at_once()
    {
        // Not one field at a time: an owner filling in a listing should see the whole remaining job.
        var missing = ListingReadiness.MissingForReview(null, null);

        Assert.Equal(2, missing.Count);
        Assert.All(missing.Values, messages => Assert.NotEmpty(messages[0]));
    }

    [Fact]
    public void The_keys_match_the_form_field_names()
    {
        // These keys are what puts the message under the right input on the owner's form.
        var missing = ListingReadiness.MissingForReview(null, null);

        Assert.Equal(["addressLine", "description"], missing.Keys.OrderBy(k => k, StringComparer.Ordinal));
    }
}
