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
}
