using System.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Listings;

/// <summary>
/// The SQL that creates and edits a listing, shared by the owner's screens and by an admin adding one
/// manually. Both paths must produce the same kind of row — same slug rules, same columns, same
/// category link — so the statements live here once instead of being written twice.
///
/// Every method takes an open connection and transaction: the caller decides what else belongs in the
/// same transaction (the audit row, for instance).
/// </summary>
public static class ListingWriter
{
    /// <summary>An area and its centre, used as the map point when the caller gives no coordinates.</summary>
    public sealed record LocalityPoint(int Id, double Latitude, double Longitude);

    public static async Task<LocalityPoint?> FindLocality(
        SqlConnection conn, SqlTransaction tx, string citySlug, string localitySlug, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT lo.id, lo.center.Lat, lo.center.Long
              FROM localities lo JOIN cities ci ON ci.id = lo.city_id
              WHERE ci.slug = @city AND lo.slug = @locality AND ci.is_active = 1 AND lo.is_active = 1", conn, tx);
        command.Parameters.AddWithValue("city", citySlug);
        command.Parameters.AddWithValue("locality", localitySlug);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct)
            ? new LocalityPoint(reader.GetInt32(0), reader.GetDouble(1), reader.GetDouble(2))
            : null;
    }

    /// <summary>Listings attach to sub-categories (level 2) only.</summary>
    public static async Task<int?> FindCategoryId(SqlConnection conn, SqlTransaction tx, string slug, CancellationToken ct)
    {
        await using var command = new SqlCommand("SELECT id FROM categories WHERE slug = @slug AND level = 2 AND is_active = 1", conn, tx);
        command.Parameters.AddWithValue("slug", slug);
        var result = await command.ExecuteScalarAsync(ct);
        return result is int id ? id : null;
    }

    /// <summary>
    /// Picks a free slug: name, name-2, name-3 ...
    ///
    /// Across the whole directory, not within the area. A public URL is now
    /// /category/subcategory/slug, with no locality in it, so two businesses of the same name in
    /// different areas would otherwise both claim /food/cafes/garden-cafe and only one could
    /// answer. S0015 added the unique index that makes this a rule rather than a convention.
    /// </summary>
    public static async Task<string> ChooseSlug(SqlConnection conn, SqlTransaction tx, string name, CancellationToken ct)
    {
        var baseSlug = SlugGenerator.FromName(name);
        var taken = new HashSet<string>();
        await using (var command = new SqlCommand(
            "SELECT slug FROM listings WHERE slug = @base OR slug LIKE @pattern", conn, tx))
        {
            command.Parameters.AddWithValue("base", baseSlug);
            command.Parameters.AddWithValue("pattern", baseSlug + "-%");
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                taken.Add(reader.GetString(0));
            }
        }
        return SlugGenerator.NextFree(baseSlug, taken);
    }

    public static async Task<long> InsertBusiness(SqlConnection conn, SqlTransaction tx, string name, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "INSERT INTO businesses (name) OUTPUT inserted.id VALUES (@name)", conn, tx);
        command.Parameters.AddWithValue("name", name);
        return (long)(await command.ExecuteScalarAsync(ct))!;
    }

    /// <param name="status">"draft" for an owner's new listing, "active" or "pending_review" for one an admin adds.</param>
    /// <param name="source">Where the row came from: "owner", "admin" or "import" (a CHECK constraint enforces it).</param>
    /// <param name="createdByUserId">The owner who created it, or null when an admin added it on the phone.</param>
    public static async Task<long> InsertListing(
        SqlConnection conn,
        SqlTransaction tx,
        long businessId,
        LocalityPoint locality,
        string slug,
        ValidListing value,
        string status,
        string source,
        long? createdByUserId,
        CancellationToken ct)
    {
        await using var command = new SqlCommand(
            /* OUTPUT ... INTO a table variable, rather than a bare OUTPUT.
               listings carries a trigger (it maintains the search trigrams, migration S0008), and
               SQL Server refuses a bare OUTPUT on a table with one: "cannot have any enabled
               triggers if the statement contains an OUTPUT clause without INTO clause". Collecting
               the id into a variable and selecting it back is the supported form, and the caller
               still reads one scalar. */
            @"DECLARE @inserted TABLE (id bigint);

              INSERT INTO listings (business_id, locality_id, slug, name, description, address_line, pincode, location,
                                    phone_primary, phone_whatsapp, website_url, status, source, created_by_user_id, published_at)
              OUTPUT inserted.id INTO @inserted
              VALUES (@business, @locality, @slug, @name, @description, @address, @pincode,
                      geography::Point(@lat, @lng, 4326),
                      @phone, @whatsapp, @website, @status, @source, @user,
                      CASE WHEN @status = 'active' THEN SYSDATETIMEOFFSET() ELSE NULL END);

              SELECT id FROM @inserted;", conn, tx);
        command.Parameters.AddWithValue("business", businessId);
        command.Parameters.AddWithValue("locality", locality.Id);
        command.Parameters.AddWithValue("slug", slug);
        command.Parameters.AddWithValue("name", value.Name);
        AddText(command, "description", value.Description);
        AddText(command, "address", value.AddressLine);
        AddText(command, "pincode", value.Pincode);
        command.Parameters.AddWithValue("lng", value.Longitude ?? locality.Longitude);
        command.Parameters.AddWithValue("lat", value.Latitude ?? locality.Latitude);
        command.Parameters.AddWithValue("phone", value.PhonePrimary);
        AddText(command, "whatsapp", value.PhoneWhatsapp);
        AddText(command, "website", value.WebsiteUrl);
        command.Parameters.AddWithValue("status", status);
        command.Parameters.AddWithValue("source", source);
        command.Parameters.Add(new SqlParameter("user", SqlDbType.BigInt) { Value = (object?)createdByUserId ?? DBNull.Value });
        return (long)(await command.ExecuteScalarAsync(ct))!;
    }

    /// <summary>
    /// Updates the editable fields. The area (and so the public URL) is never changed here, by either
    /// an owner or an admin: moving a listing to another area would break its links.
    /// </summary>
    public static async Task UpdateListing(
        SqlConnection conn,
        SqlTransaction tx,
        long listingId,
        ValidListing value,
        double currentLatitude,
        double currentLongitude,
        CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"UPDATE listings SET
                  name = @name, description = @description, address_line = @address, pincode = @pincode,
                  phone_primary = @phone, phone_whatsapp = @whatsapp, website_url = @website,
                  location = geography::Point(@lat, @lng, 4326),
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx);
        command.Parameters.AddWithValue("id", listingId);
        command.Parameters.AddWithValue("name", value.Name);
        AddText(command, "description", value.Description);
        AddText(command, "address", value.AddressLine);
        AddText(command, "pincode", value.Pincode);
        command.Parameters.AddWithValue("phone", value.PhonePrimary);
        AddText(command, "whatsapp", value.PhoneWhatsapp);
        AddText(command, "website", value.WebsiteUrl);
        // No new map point sent: keep the current one.
        command.Parameters.AddWithValue("lng", value.Longitude ?? currentLongitude);
        command.Parameters.AddWithValue("lat", value.Latitude ?? currentLatitude);
        await command.ExecuteNonQueryAsync(ct);
    }

    public static async Task AddPrimaryCategory(SqlConnection conn, SqlTransaction tx, long listingId, int categoryId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "INSERT INTO listing_categories (listing_id, category_id, is_primary) VALUES (@listing, @category, 1)", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);
        command.Parameters.AddWithValue("category", categoryId);
        await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Moves the listing to another primary category. Adds the link when the listing has none.</summary>
    public static async Task SetPrimaryCategory(SqlConnection conn, SqlTransaction tx, long listingId, int categoryId, CancellationToken ct)
    {
        await using (var update = new SqlCommand(
            "UPDATE listing_categories SET category_id = @category WHERE listing_id = @listing AND is_primary = 1", conn, tx))
        {
            update.Parameters.AddWithValue("listing", listingId);
            update.Parameters.AddWithValue("category", categoryId);
            if (await update.ExecuteNonQueryAsync(ct) > 0)
            {
                return;
            }
        }
        await AddPrimaryCategory(conn, tx, listingId, categoryId, ct);
    }

    public static void AddText(SqlCommand command, string name, string? value) =>
        command.Parameters.Add(new SqlParameter(name, SqlDbType.NVarChar) { Value = (object?)value ?? DBNull.Value });
}
