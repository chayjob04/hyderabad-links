namespace BusinessDirectory.Api.Listings;

/// <summary>
/// Validated parameters for the admin moderation queue. The rules live here rather than in the endpoint
/// so they can be unit-tested without a database, and so the status can never reach the SQL unchecked:
/// only a value from <see cref="AllowedStatuses"/> is ever used.
/// </summary>
public sealed record ModerationQueueQuery(string Status, string? Plan, int Page, int PageSize)
{
    public const int DefaultPageSize = 20;
    public const int MaxPageSize = 50;

    /// <summary>The queue an admin opens by default: everything an owner has submitted and nobody has decided on.</summary>
    public const string DefaultStatus = "pending_review";

    /// <summary>
    /// Statuses an admin may filter by. "archived" is left out: those listings are gone as far as moderation
    /// is concerned. Every value here is also allowed by the listings_status_check constraint.
    /// </summary>
    public static readonly string[] AllowedStatuses = ["pending_review", "active", "rejected", "draft", "suspended"];

    /// <summary>
    /// Every status at once, for the "All Listings" row in the Listings menu. Deliberately not in
    /// <see cref="AllowedStatuses"/>: that list is the statuses a listing can actually hold, and
    /// each value in it is also allowed by the listings_status_check constraint. This is the absence
    /// of a filter wearing a name, so it can travel in the query string.
    /// </summary>
    public const string AllStatuses = "all";

    /// <summary>
    /// The plans a listing can be filtered by. "verified" is paid up right now and "free" is not,
    /// both read from dbo.listing_entitlements rather than from what the listing once bought -- so a
    /// lapsed subscription counts as free the moment it lapses, which is what the public site shows.
    /// </summary>
    public const string FreePlan = "free";
    public const string VerifiedPlan = "verified";
    public static readonly string[] AllowedPlans = [FreePlan, VerifiedPlan];

    public int Offset => (Page - 1) * PageSize;

    /// <summary>
    /// The review queue is first-come-first-served, so waiting submissions are shown oldest first.
    /// Every other status is a lookup list, where the most recently touched listing is the interesting one.
    /// </summary>
    public bool OldestFirst => Status == DefaultStatus;

    /// <summary>No status filter at all, rather than one that happens to match everything.</summary>
    public bool EveryStatus => Status == AllStatuses;

    /// <summary>True for verified-only, false for free-only, null for both.</summary>
    public bool? VerifiedOnly => Plan switch
    {
        VerifiedPlan => true,
        FreePlan => false,
        _ => null,
    };

    /// <summary>
    /// Normalises raw query-string values. Returns null and sets <paramref name="error"/> for a status that
    /// does not exist; page numbers merely out of range are clamped rather than refused.
    /// </summary>
    public static ModerationQueueQuery? TryCreate(
        string? status, string? plan, int? page, int? pageSize, out string? error)
    {
        error = null;

        var wanted = string.IsNullOrWhiteSpace(status) ? DefaultStatus : status.Trim().ToLowerInvariant();
        if (wanted != AllStatuses && !AllowedStatuses.Contains(wanted))
        {
            error = $"status must be one of: {string.Join(", ", AllowedStatuses)}, {AllStatuses}.";
            return null;
        }

        var wantedPlan = string.IsNullOrWhiteSpace(plan) ? null : plan.Trim().ToLowerInvariant();
        if (wantedPlan is not null && !AllowedPlans.Contains(wantedPlan))
        {
            error = $"plan must be one of: {string.Join(", ", AllowedPlans)}.";
            return null;
        }

        var safePage = page is null or < 1 ? 1 : page.Value;
        var safePageSize = pageSize switch
        {
            null or < 1 => DefaultPageSize,
            > MaxPageSize => MaxPageSize,
            _ => pageSize.Value,
        };

        return new ModerationQueueQuery(wanted, wantedPlan, safePage, safePageSize);
    }
}

/// <summary>
/// The reason an admin gives when rejecting a listing. The owner reads it, so it has to say something:
/// a reviewer cannot reject with "no" or an empty box.
/// </summary>
public static class RejectionReason
{
    public const int MinLength = 10;

    /// <summary>Matches the listings_review_note_length constraint added in V0004.</summary>
    public const int MaxLength = 1000;

    /// <summary>Returns the cleaned reason, or null with <paramref name="error"/> set when it is unusable.</summary>
    public static string? TryClean(string? reason, out string? error)
    {
        error = null;
        var trimmed = reason?.Trim();

        if (string.IsNullOrEmpty(trimmed) || trimmed.Length < MinLength)
        {
            error = $"Give the owner a reason of at least {MinLength} characters, so they know what to fix.";
            return null;
        }

        if (trimmed.Length > MaxLength)
        {
            error = $"Keep the reason under {MaxLength} characters.";
            return null;
        }

        return trimmed;
    }
}
