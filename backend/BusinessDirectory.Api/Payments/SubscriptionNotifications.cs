using BusinessDirectory.Api.Notifications;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Payments;

/// <summary>
/// The receipt for a paid period.
///
/// An owner paid ₹399 and got nothing in writing: the enquiry, approval and rejection emails all
/// existed, and the one confirming money had been taken did not. That is the message someone goes
/// looking for when they want to know whether a payment worked.
///
/// Both ways in call this — the browser returning from the checkout and the webhook — and only for
/// <see cref="Subscriptions.PaymentOutcome.Activated"/>. An <c>AlreadyApplied</c> result means the
/// other path got there first and has already sent it, so a customer whose webhook and browser both
/// arrive gets one email, not two.
///
/// **Nothing here may fail a payment.** By the time this runs the money is taken and the period is
/// active and committed. A receipt that cannot be written or sent is recorded as a failed
/// notification (or, at worst, a log line) and the customer still has what they paid for.
/// </summary>
public static class SubscriptionNotifications
{
    public static async Task SendActivatedAsync(
        SqlConnection conn,
        Notifier notifier,
        Subscriptions.PaymentResult result,
        ILogger logger,
        CancellationToken ct)
    {
        if (result.Outcome != Subscriptions.PaymentOutcome.Activated
            || result.ListingId is not { } listingId
            || result.ExpiresAt is not { } expiresAt)
        {
            return;
        }

        try
        {
            var details = await ReadDetails(conn, listingId, result.PlanSlug ?? "verified", ct);
            if (details is null)
            {
                return;
            }

            // No address on file is the ordinary case for an owner who signed in by phone and never
            // typed an email. Nothing to send, and nothing is wrong.
            var owner = await OwnerLookup.ForListing(conn, null, listingId, ct);
            if (owner is null)
            {
                logger.LogInformation(
                    "Listing {ListingId} is Verified but its owner has no email address on file, so no receipt was sent.",
                    listingId);
                return;
            }

            long notificationId;
            await using (var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct))
            {
                notificationId = await Notifier.RecordPendingEmailAsync(
                    conn, tx, NotificationKinds.SubscriptionActivated, owner.Email, owner.UserId,
                    "listing", listingId, ct);
                await tx.CommitAsync(ct);
            }

            var message = EmailTemplates.SubscriptionActivatedEmail(
                owner.Email,
                new EmailTemplates.SubscriptionActivated(
                    details.BusinessName,
                    details.PlanName,
                    // From the payment record, not from the plan: the receipt must say what was
                    // charged, which stays true even if the price changes afterwards.
                    result.AmountPaise ?? 0,
                    expiresAt,
                    details.ListingPath,
                    result.Renewal),
                notifier.SiteBaseUrl);

            await notifier.DeliverAsync(conn, notificationId, message, ct);
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException)
        {
            logger.LogError(
                ex,
                "Listing {ListingId} was verified but its confirmation email could not be prepared. The payment and the subscription are unaffected.",
                listingId);
        }
    }

    private sealed record Details(string BusinessName, string PlanName, string? ListingPath);

    /// <summary>
    /// The business name, the plan's display name and the listing's public path. The path is null
    /// when the listing has no primary category, in which case the email simply carries no link to
    /// it rather than a broken one.
    /// </summary>
    private static async Task<Details?> ReadDetails(
        SqlConnection conn, long listingId, string planSlug, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT b.name, p.name, ci.slug, lo.slug, pc.slug, li.slug, pcparent.slug
              FROM dbo.listings li
              JOIN dbo.businesses b ON b.id = li.business_id
              JOIN dbo.localities lo ON lo.id = li.locality_id
              JOIN dbo.cities ci ON ci.id = lo.city_id
              JOIN dbo.plans p ON p.slug = @plan
              LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              LEFT JOIN dbo.categories pc ON pc.id = lc.category_id
              LEFT JOIN dbo.categories pcparent ON pcparent.id = pc.parent_id
              WHERE li.id = @listing", conn);
        command.Parameters.AddWithValue("listing", listingId);
        command.Parameters.AddWithValue("plan", planSlug);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        var category = await reader.IsDBNullAsync(4, ct) ? null : reader.GetString(4);
        var parent = await reader.IsDBNullAsync(6, ct) ? null : reader.GetString(6);
        var path = PublicUrl.ForListing(parent, category, reader.GetString(5));

        return new Details(reader.GetString(0), reader.GetString(1), path);
    }
}
