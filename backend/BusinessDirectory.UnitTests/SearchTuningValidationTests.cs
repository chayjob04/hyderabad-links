using BusinessDirectory.Api.Endpoints;

namespace BusinessDirectory.UnitTests;

/// <summary>
/// The rules on the two lists an admin edits under Search tuning (S0022): synonyms, and the search
/// box placeholders.
///
/// <para>
/// This file exists because the length halves of these rules were missing. `search_synonyms.term`
/// and `maps_to` are `nvarchar(100)` and `search_placeholders.text` is `nvarchar(120)`, and until
/// now the column was the only thing enforcing any of it — so a pasted sentence reached SQL Server,
/// came back as "string or binary data would be truncated", and was served to the admin as a 500
/// with nothing naming the field or the limit. The form carries no `maxlength` either, so nothing
/// stopped them typing it.
/// </para>
///
/// <para>
/// Both validators take values that are already trimmed, and the synonym one takes them already
/// lower-cased, because that is what the handlers store and the rules have to see what will be
/// stored rather than what was typed.
/// </para>
/// </summary>
public class SearchTuningValidationTests
{
    // ---- synonyms -------------------------------------------------------------------------------

    [Fact]
    public void A_usable_synonym_passes()
    {
        Assert.Null(SearchTuningEndpoints.ValidateSynonym("medical shop", "pharmacies"));
    }

    [Theory]
    [InlineData("", "pharmacies", "term")]
    [InlineData("medical shop", "", "mapsTo")]
    public void Both_halves_are_required(string term, string mapsTo, string expectedField)
    {
        var errors = SearchTuningEndpoints.ValidateSynonym(term, mapsTo);

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey(expectedField));
    }

    [Fact]
    public void A_term_exactly_at_the_limit_is_accepted()
    {
        Assert.Null(SearchTuningEndpoints.ValidateSynonym(
            new string('a', SearchTuningEndpoints.MaxTermLength), "pharmacies"));
    }

    [Fact]
    public void A_term_one_character_over_the_limit_is_refused()
    {
        var errors = SearchTuningEndpoints.ValidateSynonym(
            new string('a', SearchTuningEndpoints.MaxTermLength + 1), "pharmacies");

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("term"));
        Assert.False(errors.ContainsKey("mapsTo"));
    }

    [Fact]
    public void What_it_maps_to_is_measured_as_well()
    {
        var errors = SearchTuningEndpoints.ValidateSynonym(
            "medical shop", new string('b', SearchTuningEndpoints.MaxTermLength + 1));

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("mapsTo"));
        Assert.False(errors.ContainsKey("term"));
    }

    [Fact]
    public void Both_halves_can_be_wrong_at_once()
    {
        var errors = SearchTuningEndpoints.ValidateSynonym(
            new string('a', SearchTuningEndpoints.MaxTermLength + 1),
            new string('b', SearchTuningEndpoints.MaxTermLength + 1));

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("term"));
        Assert.True(errors.ContainsKey("mapsTo"));
    }

    [Fact]
    public void A_synonym_pointing_at_itself_is_refused()
    {
        // The rule that was already here, kept: it would expand a search into itself forever.
        var errors = SearchTuningEndpoints.ValidateSynonym("chemist", "chemist");

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("mapsTo"));
    }

    [Fact]
    public void The_same_word_rule_does_not_fire_over_a_field_that_is_already_wrong()
    {
        /* Two empty strings are equal, and "that is the same word" is confusing advice about a box
           somebody has not filled in. The emptiness is what they are told about.  */
        var errors = SearchTuningEndpoints.ValidateSynonym("", "");

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("term"));
        Assert.Equal("Enter what it should search for.", errors["mapsTo"].Single());
    }

    // ---- placeholders ---------------------------------------------------------------------------

    [Fact]
    public void A_usable_placeholder_passes()
    {
        Assert.Null(SearchTuningEndpoints.ValidatePlaceholder("Try “biryani in Madhapur”"));
    }

    [Fact]
    public void A_blank_placeholder_is_refused()
    {
        var errors = SearchTuningEndpoints.ValidatePlaceholder("");

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("text"));
    }

    [Fact]
    public void A_placeholder_exactly_at_the_limit_is_accepted()
    {
        Assert.Null(SearchTuningEndpoints.ValidatePlaceholder(
            new string('p', SearchTuningEndpoints.MaxPlaceholderLength)));
    }

    [Fact]
    public void A_placeholder_one_character_over_the_limit_is_refused()
    {
        var errors = SearchTuningEndpoints.ValidatePlaceholder(
            new string('p', SearchTuningEndpoints.MaxPlaceholderLength + 1));

        Assert.NotNull(errors);
        Assert.True(errors.ContainsKey("text"));
    }

    [Fact]
    public void The_limits_match_the_columns()
    {
        /* S0022 creates term and maps_to as nvarchar(100) and text as nvarchar(120). Asserted here
           so that changing a limit is a deliberate edit made next to a migration, rather than a
           drift that is only discovered when a save fails. */
        Assert.Equal(100, SearchTuningEndpoints.MaxTermLength);
        Assert.Equal(120, SearchTuningEndpoints.MaxPlaceholderLength);
    }
}
