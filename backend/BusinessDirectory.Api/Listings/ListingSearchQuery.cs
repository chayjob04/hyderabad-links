namespace BusinessDirectory.Api.Listings;

/// <summary>How search results are ordered. A fixed set, so the SQL never interpolates user input.</summary>
public enum ListingSortOrder
{
    Relevance,
    Distance,
    Name,
}

/// <summary>
/// Validated, normalised parameters for a public listing search. The rules live here rather than
/// inside the endpoint so they can be unit-tested without a database.
/// </summary>
public sealed record ListingSearchQuery(
    string? Text,
    string? CitySlug,
    string? LocalitySlug,
    string? CategorySlug,
    double? Latitude,
    double? Longitude,
    double? RadiusKm,
    ListingSortOrder Sort,
    /// <summary>When true, only listings with a paid Verified period running right now.</summary>
    bool VerifiedOnly,

    int Page,
    int PageSize)
{
    public const int DefaultPageSize = 20;
    public const int MaxPageSize = 50;
    public const double MinRadiusKm = 0.1;
    public const double MaxRadiusKm = 50;

    /// <summary>Longer text is cut rather than rejected: it is almost always a stray paste.</summary>
    public const int MaxTextLength = 100;

    /// <summary>Rows to skip. Safe for any <see cref="Page"/> because Page is never below 1.</summary>
    public int Offset => (Page - 1) * PageSize;

    public bool HasCoordinates => Latitude.HasValue && Longitude.HasValue;

    /// <summary>
    /// Normalises raw query-string values. Returns null and sets <paramref name="error"/> when the
    /// caller asked for something impossible; anything merely out of range is clamped instead.
    /// </summary>
    public static ListingSearchQuery? TryCreate(
        string? q,
        string? city,
        string? locality,
        string? category,
        double? lat,
        double? lng,
        double? radiusKm,
        string? sort,
        int? page,
        int? pageSize,
        bool? verifiedOnly,
        out string? error)
    {
        error = null;

        if (lat.HasValue != lng.HasValue)
        {
            error = "lat and lng must be supplied together.";
            return null;
        }

        if (lat is < -90 or > 90 || lng is < -180 or > 180)
        {
            error = "lat must be between -90 and 90, and lng between -180 and 180.";
            return null;
        }

        var text = Trim(q);
        if (text is not null && text.Length > MaxTextLength)
        {
            text = text[..MaxTextLength];
        }

        var hasCoordinates = lat.HasValue && lng.HasValue;

        if (radiusKm.HasValue && !hasCoordinates)
        {
            error = "radiusKm needs lat and lng.";
            return null;
        }

        ListingSortOrder order;
        switch (sort?.Trim().ToLowerInvariant())
        {
            case null or "":
                // No sort given: the most useful default depends on what the visitor asked for.
                order = text is not null ? ListingSortOrder.Relevance
                      : hasCoordinates ? ListingSortOrder.Distance
                      : ListingSortOrder.Name;
                break;
            case "relevance":
                order = ListingSortOrder.Relevance;
                break;
            case "distance":
                order = ListingSortOrder.Distance;
                break;
            case "name":
                order = ListingSortOrder.Name;
                break;
            default:
                error = "sort must be one of: relevance, distance, name.";
                return null;
        }

        if (order == ListingSortOrder.Distance && !hasCoordinates)
        {
            error = "sort=distance needs lat and lng.";
            return null;
        }

        return new ListingSearchQuery(
            text,
            Trim(city),
            Trim(locality),
            Trim(category),
            lat,
            lng,
            radiusKm.HasValue ? Math.Clamp(radiusKm.Value, MinRadiusKm, MaxRadiusKm) : null,
            order,
            verifiedOnly ?? false,
            Math.Max(page ?? 1, 1),
            Math.Clamp(pageSize ?? DefaultPageSize, 1, MaxPageSize));
    }

    private static string? Trim(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
