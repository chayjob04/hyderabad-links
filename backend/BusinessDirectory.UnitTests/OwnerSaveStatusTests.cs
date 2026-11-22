using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// Save Changes and Submit leave a listing in different statuses.
///
/// <para>
/// Saving used to carry the submission with it: a complete listing went to <c>pending_review</c> the
/// moment its owner pressed save, and every later edit put it back there. There was no way to put
/// half-finished work aside -- either it was incomplete, and saving left it a draft, or it was
/// complete, and saving queued it. An owner adding a photo to a listing they were not ready to show
/// anyone had no option that did not involve a reviewer.
/// </para>
/// <para>
/// The one case that did not change is an edit to a listing that is already public. That still goes
/// back through review, because the alternative is an approved listing whose text can be rewritten
/// afterwards without a reviewer seeing it -- which is what the queue is for. Holding the edit aside
/// instead, a live version beside a pending one, needs somewhere to keep it.
/// </para>
/// </summary>
public class OwnerSaveStatusTests
{
    [Theory]
    [InlineData("draft")]
    [InlineData("rejected")]
    public void Saving_leaves_a_listing_no_reviewer_has_passed_exactly_where_it_is(string status)
    {
        // The whole point: come back tomorrow and carry on, without a reviewer in between.
        Assert.Equal(status, ListingReadiness.StatusAfterOwnerSave(status, submitForReview: false));
    }

    [Theory]
    [InlineData("draft")]
    [InlineData("rejected")]
    public void Submitting_queues_a_listing_no_reviewer_has_passed(string status)
    {
        Assert.Equal("pending_review", ListingReadiness.StatusAfterOwnerSave(status, submitForReview: true));
    }

    [Theory]
    [InlineData("active")]
    [InlineData("suspended")]
    [InlineData("pending_review")]
    public void Editing_something_already_public_goes_back_through_review_either_way(string status)
    {
        /* Deliberate, and the reason this is a test rather than a comment: it is the one place where
           Save does more than save, so it must not be "fixed" without someone deciding to. */
        Assert.Equal("pending_review", ListingReadiness.StatusAfterOwnerSave(status, submitForReview: false));
        Assert.Equal("pending_review", ListingReadiness.StatusAfterOwnerSave(status, submitForReview: true));
    }

    [Fact]
    public void A_new_listing_is_a_draft_until_its_owner_submits_it()
    {
        // How the create handler asks the question: a new listing starts as a draft.
        Assert.Equal("draft", ListingReadiness.StatusAfterOwnerSave("draft", submitForReview: false));
        Assert.Equal("pending_review", ListingReadiness.StatusAfterOwnerSave("draft", submitForReview: true));
    }

    [Fact]
    public void An_approved_listing_is_never_left_active_by_a_save()
    {
        /* Stated as its own assertion because the failure would be silent and serious: an edit that
           kept the listing "active" would publish text no reviewer had seen. */
        Assert.NotEqual("active", ListingReadiness.StatusAfterOwnerSave("active", submitForReview: false));
    }

    [Theory]
    [InlineData("draft", true)]
    [InlineData("rejected", true)]
    [InlineData("active", false)]
    [InlineData("suspended", false)]
    [InlineData("pending_review", false)]
    [InlineData("archived", false)]
    public void Only_a_draft_or_a_rejection_counts_as_never_public(string status, bool expected)
    {
        Assert.Equal(expected, ListingReadiness.NeverPublic(status));
    }

    [Fact]
    public void Submitting_still_needs_the_fields_a_reviewer_reads()
    {
        /* The status rule above says where a listing lands; this is the gate in front of it. Submit
           refuses an incomplete listing and names the fields, so the form can open the section they
           are in. */
        var missing = ListingReadiness.MissingForReview(addressLine: null, description: null);

        Assert.NotEmpty(missing);
        Assert.Contains("addressLine", missing.Keys);
        Assert.Contains("description", missing.Keys);

        Assert.Empty(ListingReadiness.MissingForReview(
            "Plot 42, Hitech City Road",
            "A quiet courtyard cafe serving filter coffee all day."));
    }
}
