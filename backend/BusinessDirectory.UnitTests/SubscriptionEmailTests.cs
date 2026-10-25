using BusinessDirectory.Api.Notifications;

namespace BusinessDirectory.UnitTests;

// The receipt for a paid period. It is the one email that says money was taken, so what it claims
// matters more than the others: a wrong amount or a wrong end date is worse than no email.
//
// No provider is involved here — these assert the wording and the figures, which is the part that
// can be checked without one.
public class SubscriptionEmailTests
{
    private static readonly DateTimeOffset Until = new(2027, 10, 25, 6, 0, 0, TimeSpan.Zero);

    private static EmailTemplates.SubscriptionActivated Activated(
        long amountPaise = 39900, bool renewal = false, string? path = "/hyderabad/madhapur/plumbers/ravi-plumbing") =>
        new("Ravi Kumar Plumbing", "Verified", amountPaise, Until, path, renewal);

    [Fact]
    public void It_states_the_amount_the_plan_and_the_end_date_in_both_bodies()
    {
        var email = EmailTemplates.SubscriptionActivatedEmail(
            "owner@example.com", Activated(), "https://hyderabadlinks.com");

        foreach (var body in new[] { email.TextBody, email.HtmlBody })
        {
            Assert.Contains("Ravi Kumar Plumbing", body);
            Assert.Contains("Verified", body);
            Assert.Contains("399", body);
            // 25 October 2027 in IST, which is the date the owner's period actually ends.
            Assert.Contains("25 October 2027", body);
        }
    }

    [Fact]
    public void The_amount_comes_out_as_rupees_not_paise()
    {
        // 39900 paise is Rs 399. Printing "39900" would read as a charge a hundred times too big,
        // which is the kind of mistake that generates a refund request rather than a thank-you.
        var email = EmailTemplates.SubscriptionActivatedEmail(
            "owner@example.com", Activated(), "https://hyderabadlinks.com");

        Assert.Contains("₹399", email.TextBody);
        Assert.DoesNotContain("39900", email.TextBody);
    }

    [Fact]
    public void An_amount_with_paise_keeps_them()
    {
        var email = EmailTemplates.SubscriptionActivatedEmail(
            "owner@example.com", Activated(amountPaise: 45050), "https://hyderabadlinks.com");

        Assert.Contains("₹450.50", email.TextBody);
    }

    [Fact]
    public void A_first_payment_and_a_renewal_read_differently()
    {
        var first = EmailTemplates.SubscriptionActivatedEmail(
            "owner@example.com", Activated(renewal: false), "https://hyderabadlinks.com");
        var renewal = EmailTemplates.SubscriptionActivatedEmail(
            "owner@example.com", Activated(renewal: true), "https://hyderabadlinks.com");

        Assert.Contains("is now Verified", first.Subject);
        Assert.Contains("renewed", renewal.TextBody);
        Assert.Contains("Verified until", renewal.Subject);
        Assert.NotEqual(first.Subject, renewal.Subject);
    }

    [Fact]
    public void The_links_point_at_pages_that_exist()
    {
        var email = EmailTemplates.SubscriptionActivatedEmail(
            "owner@example.com", Activated(), "https://hyderabadlinks.com");

        Assert.Contains("https://hyderabadlinks.com/hyderabad/madhapur/plumbers/ravi-plumbing", email.TextBody);
        Assert.Contains("https://hyderabadlinks.com/account/subscription", email.TextBody);
    }

    [Fact]
    public void Without_a_site_address_it_carries_no_link_at_all()
    {
        // A relative path does nothing in a mail client, so the template leaves links out entirely
        // rather than printing one that cannot be followed.
        var email = EmailTemplates.SubscriptionActivatedEmail("owner@example.com", Activated(), siteBaseUrl: null);

        Assert.DoesNotContain("http", email.TextBody);
        Assert.DoesNotContain("/account/subscription", email.TextBody);
        // The figures are still all there: the receipt is useful without the links.
        Assert.Contains("₹399", email.TextBody);
    }

    [Fact]
    public void A_listing_with_no_category_still_gets_its_receipt()
    {
        // No primary category means no public URL. The email must still confirm the payment.
        var email = EmailTemplates.SubscriptionActivatedEmail(
            "owner@example.com", Activated(path: null), "https://hyderabadlinks.com");

        Assert.Contains("₹399", email.TextBody);
        Assert.Contains("https://hyderabadlinks.com/account/subscription", email.TextBody);
    }

    [Fact]
    public void A_business_name_cannot_inject_html()
    {
        var email = EmailTemplates.SubscriptionActivatedEmail(
            "owner@example.com",
            new EmailTemplates.SubscriptionActivated(
                "<script>alert(1)</script>", "Verified", 39900, Until, null, false),
            "https://hyderabadlinks.com");

        Assert.DoesNotContain("<script>", email.HtmlBody);
        Assert.Contains("&lt;script&gt;", email.HtmlBody);
    }

    [Fact]
    public void It_claims_nothing_it_cannot_know()
    {
        // No invoice number, because nothing issues one; no payment id, because that belongs in the
        // provider's dashboard and not in an owner's inbox.
        var email = EmailTemplates.SubscriptionActivatedEmail(
            "owner@example.com", Activated(), "https://hyderabadlinks.com");

        Assert.DoesNotContain("invoice", email.TextBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("pay_", email.TextBody);
        Assert.DoesNotContain("order_", email.TextBody);
    }
}
