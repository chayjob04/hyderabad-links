namespace BusinessDirectory.Api.Listings;

/// <summary>
/// The short lists a business is described by: what it offers, what languages it speaks, and what
/// it has on the premises (S0024).
///
/// The original Hyderabad Links kept these in three tables. They are the same shape — a label on a
/// listing, in a chosen order — so one kind column serves all three, and this class holds the rules
/// they share.
/// </summary>
public static class ListingAttributes
{
    /// <summary>The kinds the database allows, and what each is called on screen.</summary>
    public static readonly IReadOnlyDictionary<string, string> Kinds = new Dictionary<string, string>
    {
        ["offering"] = "What we offer",
        ["language"] = "Languages spoken",
        ["amenity"] = "Good to know",
    };

    /// <summary>Short by design: these are chips on a page, not sentences.</summary>
    public const int MaxLabelLength = 80;

    /// <summary>
    /// Per kind, per listing. Enough to describe a business and few enough that the page stays
    /// readable — twenty amenities is a list nobody finishes.
    /// </summary>
    public const int MaxPerKind = 12;

    /// <summary>
    /// Suggestions offered in the owner's form, per kind.
    ///
    /// Not a fixed list: the label column is free text, because no list anyone writes will contain
    /// every service in Hyderabad. These exist so the common ones are spelled the same way by
    /// everybody, which is what makes them worth anything to a reader comparing two listings.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string[]> Suggestions =
        new Dictionary<string, string[]>
        {
            ["language"] = ["Telugu", "Hindi", "English", "Urdu", "Tamil", "Kannada", "Marathi", "Bengali"],
            ["amenity"] = [
                "Parking",
                "Card payment",
                "UPI accepted",
                "Home delivery",
                "Wheelchair access",
                "Air conditioned",
                "Wi-Fi",
                "Open on Sundays",
            ],
            // Offerings are specific to the trade, so suggesting any would be suggesting the wrong
            // ones to most businesses.
            ["offering"] = [],
        };

    public sealed record AttributeDto(long Id, string Kind, string Label, int SortOrder);

    /// <summary>What was wrong with a submitted label, or null when it is fine.</summary>
    public static Dictionary<string, string[]>? Validate(string? kind, string? label)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(kind) || !Kinds.ContainsKey(kind))
        {
            errors["kind"] = [$"Choose one of: {string.Join(", ", Kinds.Keys)}."];
        }

        var trimmed = label?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
        {
            errors["label"] = ["Enter something."];
        }
        else if (trimmed.Length > MaxLabelLength)
        {
            errors["label"] = [$"Keep it under {MaxLabelLength} characters."];
        }

        return errors.Count > 0 ? errors : null;
    }
}
