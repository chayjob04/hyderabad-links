using BusinessDirectory.Api.Listings;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// What an owner may ask for, and when two requests are the same request (S0032).
///
/// The normalisation is the whole duplicate rule: whether "Nallagandla", "nallagandla " and
/// "Nalla  gandla" are one item in the queue or three depends on nothing else. And the name check
/// is what stops the queue filling with things that could never become a page.
/// </summary>
public class TaxonomySuggestionTests
{
    [Theory]
    [InlineData("Nallagandla", "nallagandla")]
    [InlineData("  Nallagandla  ", "nallagandla")]
    [InlineData("HITEC City", "hitec city")]
    [InlineData("Nalla   gandla", "nalla gandla")]
    [InlineData("Kondapur\tMain", "kondapur main")]
    public void The_same_name_typed_differently_normalises_the_same_way(string typed, string expected)
    {
        Assert.Equal(expected, TaxonomySuggestion.Normalise(typed));
    }

    [Fact]
    public void Two_owners_asking_for_the_same_area_produce_one_queue_item()
    {
        /* Which is the point of normalising at all: the filtered unique index is on this value, so
           if these two ever came out different the queue would hold the same request twice and
           somebody would answer it twice. */
        Assert.Equal(
            TaxonomySuggestion.Normalise("nallagandla"),
            TaxonomySuggestion.Normalise("  Nallagandla "));
    }

    [Theory]
    [InlineData("Nallagandla")]
    [InlineData("HITEC City")]
    [InlineData("Shop 4 Rent")]
    public void A_reasonable_name_is_accepted(string name)
    {
        Assert.True(TaxonomySuggestion.TryReadName(name, out var read, out _));
        Assert.Equal(name.Trim(), read);
    }

    [Theory]
    [InlineData("", "at least")]
    [InlineData("a", "at least")]
    [InlineData("  x ", "at least")]
    public void Something_too_short_to_be_a_name_is_refused(string name, string expected)
    {
        Assert.False(TaxonomySuggestion.TryReadName(name, out _, out var error));
        Assert.Contains(expected, error);
    }

    [Fact]
    public void A_name_that_is_too_long_is_refused_rather_than_truncated()
    {
        // Truncating would store something the owner did not ask for and then show it to staff.
        Assert.False(
            TaxonomySuggestion.TryReadName(new string('a', TaxonomySuggestion.NameMaxLength + 1), out _, out var error));
        Assert.Contains("or fewer", error);
    }

    [Theory]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("Madhapur <b>")]
    public void Angle_brackets_are_refused(string name)
    {
        /* The value is rendered on a staff screen. React escapes it, and this is the layer that
           means nobody has to rely on that being true of every screen that ever shows it. */
        Assert.False(TaxonomySuggestion.TryReadName(name, out _, out var error));
        Assert.Contains("not allowed", error);
    }

    [Theory]
    [InlineData("!!!")]
    [InlineData("...")]
    [InlineData("ಕನ್ನಡ")]
    public void A_name_with_no_english_letters_or_digits_is_refused(string name)
    {
        /* The web address is built from those characters. A name with none of them would produce
           either nothing or SlugGenerator's fallback, and the fallback would collide with the next
           such request -- which is how two unrelated areas end up fighting over one URL. */
        Assert.False(TaxonomySuggestion.TryReadName(name, out _, out var error));
        Assert.Contains("English letters or digits", error);
    }

    [Fact]
    public void An_area_and_a_category_are_the_only_two_things_that_can_be_asked_for()
    {
        Assert.Equal(["locality", "category"], TaxonomySuggestion.Kinds);
    }

    [Fact]
    public void A_request_is_in_one_of_four_states()
    {
        /* The same four the table's CHECK allows. "already exists" is a state of its own rather
           than a rejection because the owner was right to ask and the answer is a name. */
        Assert.Equal(["pending", "approved", "rejected", "already_exists"], TaxonomySuggestion.Statuses);
    }
}
