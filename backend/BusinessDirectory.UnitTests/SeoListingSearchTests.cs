using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// The SEO panel's listing search quotes what was typed.
///
/// It is a LIKE over business names, which are full of the characters LIKE treats as patterns.
/// Without quoting, "50% Off Salon" matches every listing in the directory and "[A] Cafe" matches
/// nothing -- and both read as a broken search rather than as a quoting mistake, which is why this
/// is worth a test of its own rather than a line in a handler.
/// </summary>
public class SeoListingSearchTests
{
    [Fact]
    public void An_ordinary_name_is_left_alone()
    {
        Assert.Equal("Garden Cafe", AdminSeoEndpoints.Escape("Garden Cafe"));
    }

    [Fact]
    public void A_percent_matches_itself_rather_than_everything()
    {
        Assert.Equal(@"50\% Off Salon", AdminSeoEndpoints.Escape("50% Off Salon"));
    }

    [Fact]
    public void An_underscore_matches_itself_rather_than_any_character()
    {
        Assert.Equal(@"Cafe\_One", AdminSeoEndpoints.Escape("Cafe_One"));
    }

    [Fact]
    public void A_bracket_matches_itself_rather_than_opening_a_character_class()
    {
        // Only the opening bracket. A closing one with no class open is already a literal in
        // T-SQL's LIKE, so escaping it would be quoting a character that needs no quoting.
        Assert.Equal(@"\[A] Cafe", AdminSeoEndpoints.Escape("[A] Cafe"));
    }

    [Fact]
    public void The_escape_character_is_escaped_first()
    {
        /* The order matters: escaping the backslash after the wildcards would turn the backslash
           this function just added into a literal one, and the wildcard would go back to being a
           wildcard. A name containing a backslash is unusual; a search that silently matches
           everything is not something to find out about later. */
        Assert.Equal(@"a\\b", AdminSeoEndpoints.Escape(@"a\b"));
        Assert.Equal(@"a\\\%b", AdminSeoEndpoints.Escape(@"a\%b"));
    }
}
