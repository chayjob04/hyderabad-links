using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Listings;

/// <summary>
/// A request from an owner for an area or a category that does not exist yet (S0032).
///
/// The sign-up form has always let somebody say "my area is not listed" and type the name. Nothing
/// was kept: the name went back to them with a prefilled email to support, and if nobody sent it
/// the request was gone. Each one is a row now.
///
/// <b>Approving one still creates the area or the category through the admin screens' own
/// validation</b>, with a person supplying what only a person knows — where an area is on the map,
/// and which category a new subcategory belongs under. A typed name never becomes a public page on
/// its own, because an area decides a listing's web address and a category decides where it is
/// filed. That was the reason this feature originally created nothing, and it has not changed; what
/// has changed is that the request is now in a queue instead of in somebody's inbox.
/// </summary>
public static partial class TaxonomySuggestion
{
    /// <summary>An area. The form says "area", the schema says "locality"; the schema wins here.</summary>
    public const string LocalityKind = "locality";

    /// <summary>A category. Approving one creates a subcategory, which is what listings file under.</summary>
    public const string CategoryKind = "category";

    public const string Pending = "pending";
    public const string Approved = "approved";
    public const string Rejected = "rejected";

    /// <summary>It is already there under another name, and the note says which. Not a refusal.</summary>
    public const string AlreadyExists = "already_exists";

    public static readonly string[] Kinds = [LocalityKind, CategoryKind];
    public static readonly string[] Statuses = [Pending, Approved, Rejected, AlreadyExists];

    public const int NameMinLength = 2;
    public const int NameMaxLength = 200;

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    /// <summary>
    /// The name folded for comparison: trimmed, lower case, inner runs of whitespace collapsed.
    /// </summary>
    /// <remarks>
    /// This is what the duplicate rule compares, so it has to be the same function everywhere --
    /// "Nallagandla", "nallagandla " and "Nalla  gandla" are one request or three depending only on
    /// this. Lower-cased with the invariant culture: the Turkish I would otherwise make the answer
    /// depend on the server's locale.
    /// </remarks>
    public static string Normalise(string name) =>
        Whitespace().Replace(name.Trim(), " ").ToLowerInvariant();

    /// <summary>
    /// Whether a typed name is worth storing at all, and what to say when it is not.
    /// </summary>
    /// <remarks>
    /// Angle brackets are refused for the same reason the listing validator refuses them: the value
    /// is shown back on a staff screen, and nothing that could be read as markup should reach it.
    /// A name with no English letters or digits is refused too -- the slug is built from those, so
    /// such a name could never become a page.
    /// </remarks>
    public static bool TryReadName(string? value, out string name, out string error)
    {
        name = (value ?? string.Empty).Trim();

        if (name.Length < NameMinLength)
        {
            error = $"Type at least {NameMinLength} characters.";
            return false;
        }
        if (name.Length > NameMaxLength)
        {
            error = $"Keep it to {NameMaxLength} characters or fewer.";
            return false;
        }
        if (name.Contains('<') || name.Contains('>'))
        {
            error = "The name contains characters that are not allowed (such as < or >).";
            return false;
        }
        if (!name.Any(char.IsAsciiLetterOrDigit))
        {
            error = "Include some English letters or digits: the web address is built from them.";
            return false;
        }

        error = string.Empty;
        return true;
    }

    /// <summary>One request, as both the owner's form and the admin's queue read it.</summary>
    public sealed record Row(
        long Id,
        string Kind,
        string SuggestedName,
        string Status,
        string? Note,
        long? UserId,
        string? UserPhone,
        string? UserName,
        long? ListingId,
        string? ListingName,
        int? ResolvedLocalityId,
        int? ResolvedCategoryId,
        string? ResolvedName,
        DateTimeOffset CreatedAt,
        DateTimeOffset? ReviewedAt,
        string? ReviewedBy);

    public const string Select =
        @"SELECT s.id, s.kind, s.suggested_name, s.status, s.note,
                 s.user_id, u.phone_e164, u.name,
                 s.listing_id, li.name AS listing_name,
                 s.resolved_locality_id, s.resolved_category_id,
                 COALESCE(rl.name, rc.name) AS resolved_name,
                 s.created_at, s.reviewed_at, ra.display_name
          FROM dbo.taxonomy_suggestions s
          LEFT JOIN dbo.users u ON u.id = s.user_id
          LEFT JOIN dbo.listings li ON li.id = s.listing_id
          LEFT JOIN dbo.localities rl ON rl.id = s.resolved_locality_id
          LEFT JOIN dbo.categories rc ON rc.id = s.resolved_category_id
          LEFT JOIN dbo.admin_users ra ON ra.id = s.reviewed_by_admin_id";

    public static Row Read(SqlDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.IsDBNull(4) ? null : reader.GetString(4),
        reader.IsDBNull(5) ? null : reader.GetInt64(5),
        reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.IsDBNull(7) ? null : reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetInt64(8),
        reader.IsDBNull(9) ? null : reader.GetString(9),
        reader.IsDBNull(10) ? null : reader.GetInt32(10),
        reader.IsDBNull(11) ? null : reader.GetInt32(11),
        reader.IsDBNull(12) ? null : reader.GetString(12),
        reader.GetFieldValue<DateTimeOffset>(13),
        reader.IsDBNull(14) ? null : reader.GetFieldValue<DateTimeOffset>(14),
        reader.IsDBNull(15) ? null : reader.GetString(15));

    /// <summary>
    /// Whether this name is already in the directory, and under what.
    /// </summary>
    /// <remarks>
    /// Checked before a request is stored, so an owner who types the name of an area that exists is
    /// told to pick it from the list instead of waiting for staff to tell them the same thing in a
    /// day's time. Matched on the name as well as the slug: "Hi-Tech City" and "hi-tech-city" are
    /// the same place to everybody except a string comparison.
    /// </remarks>
    public static async Task<string?> ExistingNameAsync(
        SqlConnection conn, SqlTransaction? tx, string kind, string name, CancellationToken ct)
    {
        var slug = SlugGenerator.FromName(name);
        var normalised = Normalise(name);

        var sql = kind == LocalityKind
            ? @"SELECT TOP (1) name FROM dbo.localities
                WHERE slug = @slug OR LOWER(LTRIM(RTRIM(name))) = @normalised"
            : @"SELECT TOP (1) name FROM dbo.categories
                WHERE slug = @slug OR LOWER(LTRIM(RTRIM(name))) = @normalised";

        await using var command = new SqlCommand(sql, conn, tx);
        command.Parameters.AddWithValue("slug", slug);
        command.Parameters.AddWithValue("normalised", normalised);
        return (string?)await command.ExecuteScalarAsync(ct);
    }
}
