using System.Globalization;
using System.Net;
using System.Text;

namespace BusinessDirectory.Api.Notifications;

/// <summary>
/// What each notification actually says. Kept out of the endpoints so the wording can be unit-tested
/// without a database or a provider.
///
/// Two rules shape every template here:
///   * It only states what we know. No open rate, no "12 people viewed your listing", no link to a
///     screen that does not exist. An email that invents a number is worse than no email.
///   * The HTML part says exactly what the text part says. One is not a richer version of the other,
///     so a mail client that shows either one shows the whole message.
///
/// The HTML is plain inline-styled markup on purpose: mail clients strip stylesheets, ignore most
/// modern CSS, and there is no build step for email here.
/// </summary>
public static class EmailTemplates
{
    /// <summary>A new enquiry, as the owner needs to read it: who, how to reach them, what they asked.</summary>
    /// <param name="ListingPath">
    /// The public path of the listing, e.g. "/hyderabad/madhapur/plumbers/ravi-plumbing". Null when
    /// the listing has no primary category yet and therefore no public URL. Unused by this template
    /// today, but carried with the rest of the enquiry so the caller has one shape to fill in.
    /// </param>
    public sealed record NewEnquiry(
        string BusinessName,
        string CustomerName,
        string CustomerPhone,
        string? CustomerEmail,
        string Message,
        DateTimeOffset ReceivedAt,
        string? ListingPath);

    /// <summary>A moderator's decision. <c>Reason</c> is set only for a rejection.</summary>
    public sealed record ListingDecision(string BusinessName, string? ListingPath, string? Reason);

    /// <summary>
    /// Renders the enquiry notification. <paramref name="siteBaseUrl"/> may be null, in which case
    /// the email carries no links at all rather than relative ones a mail client cannot follow.
    /// </summary>
    public static EmailMessage NewEnquiryEmail(string to, NewEnquiry enquiry, string? siteBaseUrl)
    {
        var inbox = Link(siteBaseUrl, "/account/enquiries");

        var text = new StringBuilder();
        text.AppendLine($"You have a new enquiry for {enquiry.BusinessName}.");
        text.AppendLine();
        text.AppendLine($"From:    {enquiry.CustomerName}");
        text.AppendLine($"Phone:   {enquiry.CustomerPhone}");
        if (enquiry.CustomerEmail is { Length: > 0 })
        {
            text.AppendLine($"Email:   {enquiry.CustomerEmail}");
        }
        text.AppendLine($"Sent:    {FormatIst(enquiry.ReceivedAt)}");
        text.AppendLine();
        text.AppendLine("Message:");
        text.AppendLine(enquiry.Message);
        if (inbox is not null)
        {
            text.AppendLine();
            text.AppendLine($"All your enquiries: {inbox}");
        }
        text.AppendLine();
        text.AppendLine("HYDERABAD LINKS");

        var html = new StringBuilder();
        OpenHtml(html, $"New enquiry for {enquiry.BusinessName}");
        html.Append($"<p>You have a new enquiry for <strong>{Escape(enquiry.BusinessName)}</strong>.</p>");
        html.Append("<table cellpadding=\"4\" cellspacing=\"0\" border=\"0\">");
        html.Append(Row("From", enquiry.CustomerName));
        // A phone number is the one thing the owner acts on, so it is a link a phone can dial.
        html.Append($"<tr><td><strong>Phone</strong></td><td><a href=\"tel:{Escape(enquiry.CustomerPhone)}\">{Escape(enquiry.CustomerPhone)}</a></td></tr>");
        if (enquiry.CustomerEmail is { Length: > 0 })
        {
            html.Append($"<tr><td><strong>Email</strong></td><td><a href=\"mailto:{Escape(enquiry.CustomerEmail)}\">{Escape(enquiry.CustomerEmail)}</a></td></tr>");
        }
        html.Append(Row("Sent", FormatIst(enquiry.ReceivedAt)));
        html.Append("</table>");
        html.Append($"<p style=\"white-space:pre-wrap\">{Escape(enquiry.Message)}</p>");
        if (inbox is not null)
        {
            html.Append($"<p><a href=\"{Escape(inbox)}\">See all your enquiries</a></p>");
        }
        CloseHtml(html);

        return new EmailMessage(to, $"New enquiry for {enquiry.BusinessName}", text.ToString(), html.ToString());
    }

    /// <summary>Renders the approval notification, with the live page's address when we have one.</summary>
    public static EmailMessage ListingApprovedEmail(string to, ListingDecision decision, string? siteBaseUrl)
    {
        var listingUrl = Link(siteBaseUrl, decision.ListingPath);

        var text = new StringBuilder();
        text.AppendLine($"{decision.BusinessName} is now live on HYDERABAD LINKS.");
        text.AppendLine();
        text.AppendLine("A moderator has approved your listing, so customers searching for a business");
        text.AppendLine("like yours in your area can now find it.");
        if (listingUrl is not null)
        {
            text.AppendLine();
            text.AppendLine($"Your listing: {listingUrl}");
        }
        text.AppendLine();
        text.AppendLine("HYDERABAD LINKS");

        var html = new StringBuilder();
        OpenHtml(html, $"{decision.BusinessName} is now live");
        html.Append($"<p><strong>{Escape(decision.BusinessName)}</strong> is now live on HYDERABAD LINKS.</p>");
        html.Append("<p>A moderator has approved your listing, so customers searching for a business like yours in your area can now find it.</p>");
        if (listingUrl is not null)
        {
            html.Append($"<p><a href=\"{Escape(listingUrl)}\">View your listing</a></p>");
        }
        CloseHtml(html);

        return new EmailMessage(to, $"{decision.BusinessName} is now live on HYDERABAD LINKS", text.ToString(), html.ToString());
    }

    /// <summary>
    /// Renders the rejection notification. The moderator's reason is the whole point of this email,
    /// so it is quoted as written rather than summarised into something vaguer.
    /// </summary>
    public static EmailMessage ListingRejectedEmail(string to, ListingDecision decision, string? siteBaseUrl)
    {
        var listings = Link(siteBaseUrl, "/account/listings");
        var reason = decision.Reason?.Trim();

        var text = new StringBuilder();
        text.AppendLine($"Your listing for {decision.BusinessName} has not been approved.");
        text.AppendLine();
        if (reason is { Length: > 0 })
        {
            text.AppendLine("The moderator gave this reason:");
            text.AppendLine();
            text.AppendLine(reason);
            text.AppendLine();
        }
        text.AppendLine("You can correct the listing and submit it again.");
        if (listings is not null)
        {
            text.AppendLine();
            text.AppendLine($"Your listings: {listings}");
        }
        text.AppendLine();
        text.AppendLine("HYDERABAD LINKS");

        var html = new StringBuilder();
        OpenHtml(html, $"{decision.BusinessName} has not been approved");
        html.Append($"<p>Your listing for <strong>{Escape(decision.BusinessName)}</strong> has not been approved.</p>");
        if (reason is { Length: > 0 })
        {
            html.Append("<p>The moderator gave this reason:</p>");
            html.Append($"<blockquote style=\"margin:0 0 16px;padding:8px 12px;border-left:3px solid #ccc;white-space:pre-wrap\">{Escape(reason)}</blockquote>");
        }
        html.Append("<p>You can correct the listing and submit it again.</p>");
        if (listings is not null)
        {
            html.Append($"<p><a href=\"{Escape(listings)}\">Open your listings</a></p>");
        }
        CloseHtml(html);

        return new EmailMessage(to, $"{decision.BusinessName} has not been approved", text.ToString(), html.ToString());
    }

    /// <summary>A staff request for the owner to correct something on their listing.</summary>
    /// <param name="ReasonLabel">The category, in the words the owner is shown rather than the stored code.</param>
    /// <param name="Message">What the admin wrote. Quoted as written; this is the whole point of the email.</param>
    /// <param name="SentByName">Who wrote it, so the owner is not answering an anonymous demand.</param>
    public sealed record ListingAlertDetails(
        string BusinessName,
        string? ListingPath,
        string ReasonLabel,
        string Message,
        string SentByName);

    /// <summary>
    /// Renders an alert. Unlike a rejection, the listing is still live — so this email has to ask for
    /// a change without reading as a threat to remove the business, which is the difference the
    /// wording carries.
    ///
    /// The owner is pointed at their own listings page rather than at a reply address, because
    /// nothing in this project receives replies. Asking someone to "reply to this email" when nobody
    /// reads the mailbox is worse than not asking.
    /// </summary>
    public static EmailMessage ListingAlertEmail(string to, ListingAlertDetails alert, string? siteBaseUrl)
    {
        var listings = Link(siteBaseUrl, "/account/listings");
        var message = alert.Message.Trim();

        var text = new StringBuilder();
        text.AppendLine($"We need a change to your listing for {alert.BusinessName}.");
        text.AppendLine();
        text.AppendLine($"What this is about: {alert.ReasonLabel}");
        text.AppendLine();
        text.AppendLine($"{alert.SentByName} wrote:");
        text.AppendLine();
        text.AppendLine(message);
        text.AppendLine();
        text.AppendLine("Your listing is still live. Please sign in and update it when you can.");
        if (listings is not null)
        {
            text.AppendLine();
            text.AppendLine($"Your listings: {listings}");
        }
        text.AppendLine();
        text.AppendLine("HYDERABAD LINKS");

        var html = new StringBuilder();
        OpenHtml(html, $"A change is needed to {alert.BusinessName}");
        html.Append($"<p>We need a change to your listing for <strong>{Escape(alert.BusinessName)}</strong>.</p>");
        html.Append($"<p><strong>What this is about:</strong> {Escape(alert.ReasonLabel)}</p>");
        html.Append($"<p>{Escape(alert.SentByName)} wrote:</p>");
        html.Append($"<blockquote style=\"margin:0 0 16px;padding:8px 12px;border-left:3px solid #ccc;white-space:pre-wrap\">{Escape(message)}</blockquote>");
        html.Append("<p>Your listing is still live. Please sign in and update it when you can.</p>");
        if (listings is not null)
        {
            html.Append($"<p><a href=\"{Escape(listings)}\">Open your listings</a></p>");
        }
        CloseHtml(html);

        return new EmailMessage(
            to, $"A change is needed to your {alert.BusinessName} listing", text.ToString(), html.ToString());
    }

    /// <summary>A paid period, as the owner needs it confirmed.</summary>
    /// <param name="AmountPaise">What was actually charged, taken from the payment record rather than from the plan.</param>
    /// <param name="PaidUntil">The end of the period this payment bought.</param>
    /// <param name="Renewal">True when this extended a period that was already running.</param>
    public sealed record SubscriptionActivated(
        string BusinessName,
        string PlanName,
        long AmountPaise,
        DateTimeOffset PaidUntil,
        string? ListingPath,
        bool Renewal);

    /// <summary>
    /// Confirms that money was taken and what it bought. This is the receipt an owner goes looking
    /// for, so it states the amount, the plan and the end date, and nothing it cannot know — no
    /// invoice number, because nothing issues one, and no payment id, because that belongs in the
    /// provider's dashboard rather than in an owner's inbox.
    /// </summary>
    public static EmailMessage SubscriptionActivatedEmail(
        string to, SubscriptionActivated activated, string? siteBaseUrl)
    {
        var listingUrl = Link(siteBaseUrl, activated.ListingPath);
        var plans = Link(siteBaseUrl, "/account/subscription");
        var amount = FormatRupees(activated.AmountPaise);
        var until = activated.PaidUntil.ToOffset(TimeSpan.FromMinutes(330))
            .ToString("d MMMM yyyy", CultureInfo.InvariantCulture);
        var headline = activated.Renewal
            ? $"{activated.BusinessName} is Verified until {until}"
            : $"{activated.BusinessName} is now Verified";

        var text = new StringBuilder();
        text.AppendLine(headline + ".");
        text.AppendLine();
        text.AppendLine(activated.Renewal
            ? $"Your {activated.PlanName} plan has been renewed. We received {amount}."
            : $"We received {amount} for the {activated.PlanName} plan. Thank you.");
        text.AppendLine();
        text.AppendLine($"Plan:         {activated.PlanName}");
        text.AppendLine($"Amount paid:  {amount}");
        text.AppendLine($"Verified until: {until}");
        text.AppendLine();
        text.AppendLine("Your listing now carries the Verified badge, and you can add photos, video");
        text.AppendLine("and up to five website and social links.");
        if (listingUrl is not null)
        {
            text.AppendLine();
            text.AppendLine($"Your listing: {listingUrl}");
        }
        if (plans is not null)
        {
            text.AppendLine($"Your plan:    {plans}");
        }
        text.AppendLine();
        text.AppendLine("HYDERABAD LINKS");

        var html = new StringBuilder();
        OpenHtml(html, headline);
        html.Append($"<p><strong>{Escape(headline)}</strong>.</p>");
        html.Append(activated.Renewal
            ? $"<p>Your {Escape(activated.PlanName)} plan has been renewed. We received {Escape(amount)}.</p>"
            : $"<p>We received {Escape(amount)} for the {Escape(activated.PlanName)} plan. Thank you.</p>");
        html.Append("<table cellpadding=\"6\" style=\"border-collapse:collapse\">");
        html.Append(Row("Plan", activated.PlanName));
        html.Append(Row("Amount paid", amount));
        html.Append(Row("Verified until", until));
        html.Append("</table>");
        html.Append("<p>Your listing now carries the Verified badge, and you can add photos, video and up to five website and social links.</p>");
        if (listingUrl is not null)
        {
            html.Append($"<p><a href=\"{Escape(listingUrl)}\">View your listing</a></p>");
        }
        if (plans is not null)
        {
            html.Append($"<p><a href=\"{Escape(plans)}\">Manage your plan</a></p>");
        }
        CloseHtml(html);

        return new EmailMessage(to, headline, text.ToString(), html.ToString());
    }

    // ------------------------------------------------------------------ helpers
    /// <summary>
    /// Paise as rupees, the way a price is written here: 39900 becomes "₹399". Paise are shown only
    /// when there are any, so a round amount does not read as "₹399.00" in a receipt.
    /// </summary>
    private static string FormatRupees(long paise)
    {
        var rupees = paise / 100m;
        return "₹" + rupees.ToString(paise % 100 == 0 ? "N0" : "N2", CultureInfo.GetCultureInfo("en-IN"));
    }

    /// <summary>
    /// An absolute URL, or null when either half is missing. Returning null is what makes the
    /// templates leave a link out instead of printing "/account/enquiries", which does nothing in a
    /// mail client.
    /// </summary>
    private static string? Link(string? siteBaseUrl, string? path)
    {
        if (string.IsNullOrWhiteSpace(siteBaseUrl) || string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        return $"{siteBaseUrl.TrimEnd('/')}/{path.TrimStart('/')}";
    }

    /// <summary>
    /// Everything stored is UTC; everyone reading these emails is in Hyderabad. The offset is fixed
    /// and India has no daylight saving, so adding 5:30 beats depending on a named time zone being
    /// installed on the host — it is not, in some Linux containers.
    /// </summary>
    private static string FormatIst(DateTimeOffset moment) =>
        moment.ToOffset(TimeSpan.FromMinutes(330)).ToString("d MMM yyyy, h:mm tt", CultureInfo.InvariantCulture) + " IST";

    private static string Escape(string value) => WebUtility.HtmlEncode(value);

    private static string Row(string label, string value) =>
        $"<tr><td><strong>{Escape(label)}</strong></td><td>{Escape(value)}</td></tr>";

    private static void OpenHtml(StringBuilder html, string title)
    {
        html.Append("<!doctype html><html><head><meta charset=\"utf-8\"><title>");
        html.Append(Escape(title));
        html.Append("</title></head><body style=\"font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111\">");
    }

    private static void CloseHtml(StringBuilder html) =>
        html.Append("<p style=\"color:#666;font-size:13px\">HYDERABAD LINKS</p></body></html>");
}
