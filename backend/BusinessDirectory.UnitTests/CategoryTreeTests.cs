using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// The three tiers of the taxonomy and the rules between them.
///
/// Segment &gt; Category &gt; Subcategory, in one table with a <c>level</c> column (S0030). These
/// look like trivia until you remember what the numbers decide: which tier a row belongs to, what
/// a new row's parent may be, and whether its public page is one path segment deep or two. The
/// first of those was got wrong once — the public tree read "is this a top level row?" from whether
/// it had a parent, and a category acquiring a segment emptied every menu on the site.
/// </summary>
public class CategoryTreeTests
{
    [Fact]
    public void The_tiers_are_numbered_from_the_segment_down()
    {
        /* Pinned as numbers, not derived, because the migration writes the same numbers into the
           database's own CHECK. If one side ever moves, this fails and the other side has to move
           with it. */
        Assert.Equal(0, CategoryTree.SegmentLevel);
        Assert.Equal(1, CategoryTree.CategoryLevel);
        Assert.Equal(2, CategoryTree.SubcategoryLevel);
    }

    [Fact]
    public void A_segment_is_the_top_so_nothing_is_above_it()
    {
        Assert.Null(CategoryTree.ParentLevelFor(CategoryTree.SegmentLevel));
    }

    [Fact]
    public void A_category_sits_under_a_segment_and_a_subcategory_under_a_category()
    {
        Assert.Equal(CategoryTree.SegmentLevel, CategoryTree.ParentLevelFor(CategoryTree.CategoryLevel));
        Assert.Equal(CategoryTree.CategoryLevel, CategoryTree.ParentLevelFor(CategoryTree.SubcategoryLevel));
    }

    [Fact]
    public void A_segment_and_a_category_are_one_path_segment_deep_a_subcategory_is_two()
    {
        /* This is what keeps /food and /restaurants-and-food both working at the root while
           /restaurants-and-food/cafes is the one with a parent in its address. Getting it wrong
           puts a segment in the sitemap as /null/food. */
        Assert.True(CategoryTree.IsOneSegmentDeep(CategoryTree.SegmentLevel));
        Assert.True(CategoryTree.IsOneSegmentDeep(CategoryTree.CategoryLevel));
        Assert.False(CategoryTree.IsOneSegmentDeep(CategoryTree.SubcategoryLevel));
    }

    [Fact]
    public void Every_tier_is_listed_once_lowest_first()
    {
        Assert.Equal([CategoryTree.SegmentLevel, CategoryTree.CategoryLevel, CategoryTree.SubcategoryLevel], CategoryTree.Levels);
        Assert.Equal(CategoryTree.Levels.Length, CategoryTree.Levels.Distinct().Count());
    }

    [Fact]
    public void An_unknown_tier_has_no_parent_rather_than_a_guessed_one()
    {
        // A level that is not one of the three is a bug somewhere else; answering "under a
        // category" would turn it into a bad row instead of a refused one.
        Assert.Null(CategoryTree.ParentLevelFor(3));
        Assert.Null(CategoryTree.ParentLevelFor(-1));
    }
}
