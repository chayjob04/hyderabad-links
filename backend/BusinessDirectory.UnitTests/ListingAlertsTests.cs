using BusinessDirectory.Api.Listings;
using BusinessDirectory.Api.Notifications;

namespace BusinessDirectory.UnitTests;

// What may be sent to a business owner, and what the email says when it is.
//
// The validation matters more than it looks. This is the one message the owner will read about a
// problem with their listing, and nothing in this project receives a reply — so an alert that says
// "wrong" has wasted it, and the owner's only remaining option is to guess.
public class ListingAlertsTests
{
    private const string GoodMessage = "Your opening hours still say 9pm but the sign says 8pm.";

    [Fact]
    public void A_complete_alert_is_accepted()
    {
        Assert.Null(ListingAlerts.Validate("incorrect_details", GoodMessage));
    }

    [Theory]
    [InlineData("incorrect_details")]
    [InlineData("missing_information")]
    [InlineData("wrong_category")]
    [InlineData("photo_problem")]
    [InlineData("policy")]
    [InlineData("other")]
    public void Every_offered_reason_is_accepted(string reason)
    {
        // The same list the S0017 CHECK constraint allows. If these ever disagree, a reason the UI
        // offers would be refused by the database at the moment of sending.
        Assert.Null(ListingAlerts.Validate(reason, GoodMessage));
        Assert.True(ListingAlerts.Reasons.ContainsKey(reason));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("urgent")]
    [InlineData("INCORRECT_DETAILS")]
    public void A_reason_outside_the_list_is_refused(string? reason)
    {
        // Case included on purpose: the stored values are lower case, and accepting a different case
        // here would hand the database a value its constraint rejects.
        var errors = ListingAlerts.Validate(reason, GoodMessage);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("reason"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("wrong")]
    [InlineData("fix it")]
    public void A_message_too_short_to_act_on_is_refused(string? message)
    {
        var errors = ListingAlerts.Validate("incorrect_details", message);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("message"));
    }

    [Fact]
    public void Whitespace_does_not_count_towards_the_minimum()
    {
        var errors = ListingAlerts.Validate("other", "  bad    ");

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("message"));
    }

    [Fact]
    public void A_message_longer_than_the_column_is_refused_rather_than_truncated()
    {
        // The column is nvarchar(2000). Refusing beats silently cutting the sentence that said what
        // to change, and beats a 500 from the database.
        var errors = ListingAlerts.Validate("other", new string('a', ListingAlerts.MaxMessageLength + 1));

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("message"));
    }

    [Fact]
    public void A_message_exactly_at_the_limit_is_accepted()
    {
        Assert.Null(ListingAlerts.Validate("other", new string('a', ListingAlerts.MaxMessageLength)));
    }

    [Fact]
    public void Both_problems_are_reported_at_once()
    {
        // One round trip, so the sender is not told about the reason, fixes it, and only then
        // learns the message was too short as well.
        var errors = ListingAlerts.Validate("not-a-reason", "no");

        Assert.NotNull(errors);
        Assert.Equal(2, errors.Count);
    }

    // ------------------------------------------------------------------ the email
    [Fact]
    public void The_email_quotes_the_message_and_says_who_wrote_it()
    {
        var email = EmailTemplates.ListingAlertEmail(
            "owner@example.test",
            new EmailTemplates.ListingAlertDetails(
                "Garden Cafe", "/food/cafes/garden-cafe", "Incorrect details", GoodMessage, "Asha"),
            "https://hyderabadlinks.test");

        Assert.Contains("Garden Cafe", email.Subject);
        Assert.Contains(GoodMessage, email.TextBody);
        Assert.Contains("Asha", email.TextBody);
        Assert.Contains("Incorrect details", email.TextBody);

        // The listing stays live, and the email must not read like a removal notice: that is the
        // whole difference between an alert and a rejection.
        Assert.Contains("still live", email.TextBody);
    }

    [Fact]
    public void The_email_escapes_a_message_that_contains_markup()
    {
        // The message is typed by staff and rendered into HTML mail. An unescaped tag would be a
        // script running in whatever client the owner opens it in.
        var email = EmailTemplates.ListingAlertEmail(
            "owner@example.test",
            new EmailTemplates.ListingAlertDetails(
                "Garden Cafe", null, "Something else", "Remove <script>alert(1)</script> please now", "Asha"),
            "https://hyderabadlinks.test");

        Assert.DoesNotContain("<script>", email.HtmlBody);
        Assert.Contains("&lt;script&gt;", email.HtmlBody);
    }

    [Fact]
    public void The_email_still_renders_with_no_site_base_url()
    {
        // Email:SiteBaseUrl is optional, and a missing one must not produce a link to nowhere.
        var email = EmailTemplates.ListingAlertEmail(
            "owner@example.test",
            new EmailTemplates.ListingAlertDetails("Garden Cafe", null, "Something else", GoodMessage, "Asha"),
            siteBaseUrl: null);

        Assert.Contains(GoodMessage, email.TextBody);
        Assert.DoesNotContain("href=\"\"", email.HtmlBody);
        Assert.DoesNotContain("null", email.HtmlBody);
    }
}
