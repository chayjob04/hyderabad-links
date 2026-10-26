namespace BusinessDirectory.Api.Listings;

/// <summary>
/// Every public path the site has, built in one place.
///
/// It was previously built by string interpolation in seven handlers, each repeating
/// <c>$"/{city}/{locality}/{category}/{slug}"</c>. That was fine until the shape changed: a path
/// built in seven places is changed in six, and the seventh sends somebody to a 404 that nothing
/// fails on. Receipt emails were that seventh.
///
/// The shape is category-first:
/// <code>
///   /food/cafes                 every cafe
///   /food/cafes/garden-cafe     one listing
///   /areas/madhapur             every business in an area
///   /areas/madhapur/cafes       cafes in an area
/// </code>
/// There is no city segment: the directory covers one city, and the database still records which,
/// so adding it back later is a routing change rather than a data migration.
///
/// <c>areas</c> is reserved as a first segment — see <see cref="ReservedFirstSegment"/>.
/// </summary>
public static class PublicUrl
{
    /// <summary>
    /// The one first-level path that is not a category. `/areas/madhapur` and `/food/cafes` are
    /// both two segments, so a category whose slug was "areas" would make an area page
    /// unreachable. The taxonomy endpoints refuse that slug for exactly this reason.
    /// </summary>
    public const string ReservedFirstSegment = "areas";

    /// <summary>
    /// A listing's page, or null when it has no primary category yet: the path is built from one,
    /// so a listing without it has no public page — which is also why the review queue shows such
    /// a listing rather than hiding it.
    /// </summary>
    public static string? ForListing(string? parentCategorySlug, string? categorySlug, string listingSlug) =>
        string.IsNullOrEmpty(parentCategorySlug) || string.IsNullOrEmpty(categorySlug)
            ? null
            : $"/{parentCategorySlug}/{categorySlug}/{listingSlug}";

    /// <summary>A subcategory's page: every business filed under it.</summary>
    public static string ForCategory(string parentCategorySlug, string categorySlug) =>
        $"/{parentCategorySlug}/{categorySlug}";

    /// <summary>A top-level category's page, which lists its subcategories.</summary>
    public static string ForTopCategory(string parentCategorySlug) => $"/{parentCategorySlug}";

    /// <summary>An area's page: every business in it, whatever the category.</summary>
    public static string ForArea(string localitySlug) => $"/{ReservedFirstSegment}/{localitySlug}";

    /// <summary>An area narrowed to one subcategory — "cafes in Madhapur".</summary>
    public static string ForAreaCategory(string localitySlug, string categorySlug) =>
        $"/{ReservedFirstSegment}/{localitySlug}/{categorySlug}";
}
