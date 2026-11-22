namespace BusinessDirectory.Api.Listings;

/// <summary>
/// What each tier of <c>dbo.categories</c> means, in one place.
///
/// The taxonomy is <b>Segment &gt; Category &gt; Subcategory</b>, held in one table with a
/// <c>level</c> column and a composite foreign key that requires a parent to exist at the tier
/// above (<c>categories_three_levels</c>, S0030).
///
/// <b>Why the segment is zero rather than one.</b> Categories and subcategories were levels 1 and 2
/// before segments existed, and renumbering them would have rewritten the level of every row and
/// every query that reads one — on a database that cannot be tested against outside production. The
/// new tier is numbered above the others instead, so <c>level = 1</c> still means "category"
/// everywhere it is already written and a listing is still filed under a <c>level = 2</c> row. The
/// migration's own header argues this at length.
///
/// These are named constants rather than literals because the mistake they guard against has
/// already happened once: the public category tree decided which tier a row belonged to by whether
/// it had a parent, and a category acquiring a segment turned every menu on the site into seven
/// empty headings.
/// </summary>
public static class CategoryTree
{
    /// <summary>The top tier: Food, Stays, Shopping &amp; Retail, Services, and so on.</summary>
    public const short SegmentLevel = 0;

    /// <summary>A category, such as Restaurants and Food. Sits under a segment, or under nothing.</summary>
    public const short CategoryLevel = 1;

    /// <summary>A subcategory, such as Cafes. The only tier a listing may be filed under.</summary>
    public const short SubcategoryLevel = 2;

    /// <summary>Every tier, lowest first, for validating a level that arrived from outside.</summary>
    public static readonly short[] Levels = [SegmentLevel, CategoryLevel, SubcategoryLevel];

    /// <summary>
    /// The tier a parent must be at, or null when this tier has no parent. A segment is the top, so
    /// nothing is above it; a category's parent is a segment; a subcategory's is a category.
    /// </summary>
    public static short? ParentLevelFor(short level) => level switch
    {
        SegmentLevel => null,
        CategoryLevel => SegmentLevel,
        SubcategoryLevel => CategoryLevel,
        _ => null,
    };

    /// <summary>True for a tier whose page is one path segment deep: /food, /restaurants-and-food.</summary>
    public static bool IsOneSegmentDeep(short level) => level <= CategoryLevel;
}
