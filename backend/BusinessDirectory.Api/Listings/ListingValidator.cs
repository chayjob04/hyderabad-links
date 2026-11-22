using System.Text.RegularExpressions;
using BusinessDirectory.Api.Auth;

namespace BusinessDirectory.Api.Listings;

/// <summary>What an owner sends when creating or editing a listing. Everything is untrusted until validated.</summary>
public sealed record ListingInput(
    string? Name,
    string? Description,
    string? CitySlug,
    string? LocalitySlug,
    string? CategorySlug,
    string? AddressLine,
    string? Pincode,
    string? PhonePrimary,
    string? PhoneWhatsapp,
    string? WebsiteUrl,
    double? Latitude,
    double? Longitude)
{
    /// <summary>
    /// Whether the owner pressed Submit rather than Save Changes.
    /// </summary>
    /// <remarks>
    /// An extra init-only property rather than a constructor parameter, so the admin and
    /// super-admin paths that build a <see cref="ListingInput"/> positionally are untouched -- they
    /// pass a status to <c>ListingWriter</c> explicitly and never consult this.
    ///
    /// Absent means Save Changes: the listing is stored and stays where it is. Saving used to carry
    /// the submission with it, so an owner could not put half-finished work aside without either
    /// losing it or queueing it for a reviewer.
    /// </remarks>
    public bool SubmitForReview { get; init; }
}

/// <summary>The cleaned, normalised version of <see cref="ListingInput"/>.</summary>
public sealed record ValidListing(
    string Name,
    string? Description,
    string CitySlug,
    string? LocalitySlug,
    string CategorySlug,
    string? AddressLine,
    string? Pincode,
    string PhonePrimary,
    string? PhoneWhatsapp,
    string? WebsiteUrl,
    double? Latitude,
    double? Longitude);

public sealed record ListingValidationResult(ValidListing? Value, Dictionary<string, string[]> Errors);

public static partial class ListingValidator
{
    public const string DefaultCity = "hyderabad";

    // A rough box around Hyderabad. A map point outside it is almost certainly a mistake.
    public const double MinLatitude = 17.0, MaxLatitude = 17.9, MinLongitude = 78.0, MaxLongitude = 78.9;

    [GeneratedRegex("^[1-9][0-9]{5}$")]
    private static partial Regex PincodePattern();

    [GeneratedRegex("^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex SlugPattern();

    /// <param name="requireLocality">True when creating (the area cannot be changed afterwards).</param>
    /// <param name="fallbackPhone">
    /// The owner's verified login number, used when no phone is given. Null when an admin is adding a
    /// listing on someone's behalf: there is no number to fall back on, so one must be typed in.
    /// </param>
    public static ListingValidationResult Validate(ListingInput input, bool requireLocality, string? fallbackPhone)
    {
        var errors = new Dictionary<string, string[]>();
        void Fail(string field, string message) => errors[field] = [message];

        var name = Clean(input.Name);
        if (name is null || name.Length < 2 || name.Length > 120)
        {
            Fail("name", "Enter the business name (2 to 120 characters).");
        }
        else if (HasBadCharacters(name, allowNewlines: false))
        {
            Fail("name", "The name contains characters that are not allowed (such as < or >).");
        }

        var description = Clean(input.Description);
        if (description is not null && description.Length > 2000)
        {
            Fail("description", "The description can be at most 2000 characters.");
        }
        else if (description is not null && HasBadCharacters(description, allowNewlines: true))
        {
            Fail("description", "The description contains characters that are not allowed (such as < or >).");
        }

        var address = Clean(input.AddressLine);
        if (address is not null && address.Length > 300)
        {
            Fail("addressLine", "The address can be at most 300 characters.");
        }
        else if (address is not null && HasBadCharacters(address, allowNewlines: false))
        {
            Fail("addressLine", "The address contains characters that are not allowed (such as < or >).");
        }

        var pincode = Clean(input.Pincode);
        if (pincode is not null && !PincodePattern().IsMatch(pincode))
        {
            Fail("pincode", "Enter a 6-digit pincode.");
        }

        var city = Clean(input.CitySlug)?.ToLowerInvariant() ?? DefaultCity;
        var locality = Clean(input.LocalitySlug)?.ToLowerInvariant();
        if (requireLocality && (locality is null || !SlugPattern().IsMatch(locality)))
        {
            Fail("localitySlug", "Choose the area where the business is located.");
        }
        if (!SlugPattern().IsMatch(city))
        {
            Fail("citySlug", "Unknown city.");
        }

        var category = Clean(input.CategorySlug)?.ToLowerInvariant();
        if (category is null || !SlugPattern().IsMatch(category))
        {
            Fail("categorySlug", "Choose a category.");
        }

        var phonePrimary = fallbackPhone;
        if (Clean(input.PhonePrimary) is { } primaryRaw)
        {
            if (PhoneNumber.TryNormalizeIndia(primaryRaw, out var normalised))
            {
                phonePrimary = normalised;
            }
            else
            {
                Fail("phonePrimary", "Enter a valid 10-digit Indian mobile number.");
            }
        }
        else if (phonePrimary is null)
        {
            Fail("phonePrimary", "Enter the business phone number.");
        }

        string? phoneWhatsapp = null;
        if (Clean(input.PhoneWhatsapp) is { } whatsappRaw)
        {
            if (PhoneNumber.TryNormalizeIndia(whatsappRaw, out var normalised))
            {
                phoneWhatsapp = normalised;
            }
            else
            {
                Fail("phoneWhatsapp", "Enter a valid 10-digit Indian mobile number.");
            }
        }

        string? website = null;
        if (Clean(input.WebsiteUrl) is { } websiteRaw)
        {
            var candidate = websiteRaw.Contains("://", StringComparison.Ordinal) ? websiteRaw : "https://" + websiteRaw;
            if (candidate.Length <= 300
                && Uri.TryCreate(candidate, UriKind.Absolute, out var uri)
                && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
                && uri.Host.Contains('.', StringComparison.Ordinal))
            {
                website = uri.ToString();
            }
            else
            {
                Fail("websiteUrl", "Enter a valid website address, for example https://example.com.");
            }
        }

        if (input.Latitude.HasValue != input.Longitude.HasValue)
        {
            Fail("latitude", "Send both latitude and longitude, or neither.");
        }
        else if (input.Latitude is { } lat && input.Longitude is { } lng
                 && (double.IsNaN(lat) || double.IsNaN(lng)
                     || lat < MinLatitude || lat > MaxLatitude || lng < MinLongitude || lng > MaxLongitude))
        {
            Fail("latitude", "The map point must be inside Hyderabad.");
        }

        if (errors.Count > 0)
        {
            return new ListingValidationResult(null, errors);
        }

        return new ListingValidationResult(
            new ValidListing(name!, description, city, locality, category!, address, pincode, phonePrimary!, phoneWhatsapp, website, input.Latitude, input.Longitude),
            errors);
    }

    private static string? Clean(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static bool HasBadCharacters(string value, bool allowNewlines)
    {
        foreach (var ch in value)
        {
            if (ch is '<' or '>')
            {
                return true;
            }
            if (char.IsControl(ch) && !(allowNewlines && ch is '\n' or '\r' or '\t'))
            {
                return true;
            }
        }
        return false;
    }
}
