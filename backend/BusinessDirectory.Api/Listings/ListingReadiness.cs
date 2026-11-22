namespace BusinessDirectory.Api.Listings;

/// <summary>
/// What a listing needs before a reviewer should see it.
///
/// This used to live inside the owner's "submit for review" handler, as the gate on a button the
/// owner had to find and press. Listings now go to review on save instead, so the same rule is
/// needed in three places — creating, editing, and the submit endpoint that still serves older
/// drafts — and all three must agree. A listing that reached the queue by one path and would have
/// been refused by another is a bug nobody notices until a moderator is staring at a blank address.
/// </summary>
public static class ListingReadiness
{
    /// <summary>Long enough to say what the business actually does, short enough not to be a chore.</summary>
    public const int MinimumDescriptionLength = 20;

    /// <summary>
    /// Empty when the listing is ready for a reviewer. Otherwise the fields that are missing, keyed
    /// the way the form names them, so the message lands on the right input.
    /// </summary>
    public static Dictionary<string, string[]> MissingForReview(string? addressLine, string? description)
    {
        var missing = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(addressLine))
        {
            missing["addressLine"] = ["Add the business address before this can be reviewed."];
        }

        if (description is null || description.Trim().Length < MinimumDescriptionLength)
        {
            missing["description"] = [
                $"Add a short description (at least {MinimumDescriptionLength} characters) before this can be reviewed."
            ];
        }

        return missing;
    }

    /// <summary>True when nothing is missing, for the common "which status does this get?" question.</summary>
    public static bool IsReadyForReview(string? addressLine, string? description) =>
        MissingForReview(addressLine, description).Count == 0;

    /// <summary>
    /// The status a listing is left in when its owner saves or submits it.
    /// </summary>
    /// <remarks>
    /// Here rather than in the handler so the three cases can be asserted without a database, the
    /// same reason <see cref="MissingForReview"/> lives here.
    ///
    /// <list type="bullet">
    /// <item>Submit always queues it, whatever it was.</item>
    /// <item>Save leaves a listing no reviewer has passed yet exactly where it is -- a draft stays
    /// a draft, a rejection stays a rejection -- which is what lets an owner build a listing over
    /// several sittings.</item>
    /// <item>Save on a listing that is already public queues it anyway. The alternative is an
    /// approved listing whose text can be rewritten afterwards without a reviewer seeing it, which
    /// is the one thing the queue exists to prevent.</item>
    /// </list>
    /// </remarks>
    public static string StatusAfterOwnerSave(string currentStatus, bool submitForReview) =>
        submitForReview || !NeverPublic(currentStatus) ? "pending_review" : currentStatus;

    /// <summary>
    /// True for a listing no reviewer has passed: a draft, or one that came back rejected. Both are
    /// invisible to the public, so saving one in any state costs nothing.
    /// </summary>
    public static bool NeverPublic(string currentStatus) =>
        currentStatus is "draft" or "rejected";
}
