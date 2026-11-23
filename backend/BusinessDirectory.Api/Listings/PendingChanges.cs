using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Listings;

/// <summary>
/// An edit to a listing that is already published, kept aside until a moderator sees it (S0031).
///
/// Saving a live listing used to send it straight back into the review queue, which took the
/// business off the site while its owner corrected a phone number. Now the edit goes here, the
/// listing keeps its 'active' status, and the public page keeps serving the approved version until
/// somebody approves the change.
///
/// <b>What is staged</b> is exactly what the owner's "Business details" form writes, and nothing
/// else. Photos, opening hours, questions, amenities and links have always published immediately and
/// still do; staging them would be a parallel copy of five more tables and a change to behaviour
/// nobody asked to change. The boundary is the one that already existed.
///
/// Every statement here is parameterised and every write is given the caller's transaction, because
/// applying a staged edit touches two tables -- the listing and its primary category -- and a half
/// applied approval would publish a name without its category.
/// </summary>
public static class PendingChanges
{
    /// <summary>Saved by the owner and private to them: nobody is waiting on it.</summary>
    public const string Draft = "draft";

    /// <summary>Submitted. It is in the moderator's queue.</summary>
    public const string PendingReview = "pending_review";

    /// <summary>A moderator refused it, with a note. The owner edits the same row again.</summary>
    public const string Rejected = "rejected";

    /// <summary>
    /// Whether a listing in this status serves a public page.
    ///
    /// This is the one question that decides where an owner's save goes: a published listing's edit
    /// is staged, and anything else is written straight through, because there is no public version
    /// to protect. 'suspended' is public-ish -- it is hidden, and its owner cannot edit it at all --
    /// and 'archived' cannot be edited either, so both are refused before this is asked.
    /// </summary>
    public static bool IsPublished(string listingStatus) => listingStatus == "active";

    /// <summary>The staged values, as both the owner's screens and the moderator's read them.</summary>
    public sealed record Staged(
        long Id,
        long ListingId,
        string Status,
        string? Name,
        string? Description,
        string? AddressLine,
        string? Pincode,
        string? PhonePrimary,
        string? PhoneWhatsapp,
        string? WebsiteUrl,
        int? CategoryId,
        string? CategorySlug,
        string? CategoryName,
        string? ReviewNote,
        DateTimeOffset? SubmittedAt,
        DateTimeOffset? ReviewedAt,
        DateTimeOffset UpdatedAt);

    private const string Select =
        @"SELECT p.id, p.listing_id, p.status, p.name, p.description, p.address_line, p.pincode,
                 p.phone_primary, p.phone_whatsapp, p.website_url, p.category_id,
                 c.slug, c.name, p.review_note, p.submitted_at, p.reviewed_at, p.updated_at
          FROM dbo.listing_pending_changes p
          LEFT JOIN dbo.categories c ON c.id = p.category_id";

    private static Staged Read(SqlDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetInt64(1),
        reader.GetString(2),
        reader.IsDBNull(3) ? null : reader.GetString(3),
        reader.IsDBNull(4) ? null : reader.GetString(4),
        reader.IsDBNull(5) ? null : reader.GetString(5),
        reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.IsDBNull(7) ? null : reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetString(8),
        reader.IsDBNull(9) ? null : reader.GetString(9),
        reader.IsDBNull(10) ? null : reader.GetInt32(10),
        reader.IsDBNull(11) ? null : reader.GetString(11),
        reader.IsDBNull(12) ? null : reader.GetString(12),
        reader.IsDBNull(13) ? null : reader.GetString(13),
        reader.IsDBNull(14) ? null : reader.GetFieldValue<DateTimeOffset>(14),
        reader.IsDBNull(15) ? null : reader.GetFieldValue<DateTimeOffset>(15),
        reader.GetFieldValue<DateTimeOffset>(16));

    /// <summary>The staged edit for one listing, or null when there is none.</summary>
    public static async Task<Staged?> ForListingAsync(
        SqlConnection conn, SqlTransaction? tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand($"{Select} WHERE p.listing_id = @listing", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? Read(reader) : null;
    }

    /// <summary>
    /// Every staged edit belonging to one owner, keyed by listing.
    /// </summary>
    /// <remarks>
    /// One query rather than one per listing, and joined through <c>business_members</c> so it can
    /// only ever return rows for listings this user is authorised for -- the same join the owner's
    /// listing query uses. An owner has at most five listings, so this is small by construction.
    /// </remarks>
    public static async Task<Dictionary<long, Staged>> ForOwnerAsync(
        SqlConnection conn, SqlTransaction? tx, long userId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            $@"{Select}
               JOIN dbo.listings li ON li.id = p.listing_id
               JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user",
            conn, tx);
        command.Parameters.AddWithValue("user", userId);

        var staged = new Dictionary<long, Staged>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var row = Read(reader);
            staged[row.ListingId] = row;
        }
        return staged;
    }

    /// <summary>
    /// Writes the owner's edit, replacing whatever was staged before.
    /// </summary>
    /// <remarks>
    /// A delete and an insert inside the caller's transaction rather than a MERGE, which is the
    /// pattern this project uses everywhere (see AdminSeoEndpoints): the unique index on
    /// <c>listing_id</c> makes a duplicate impossible either way, and two plain statements are
    /// easier to read than one clever one.
    ///
    /// Submitting clears any previous rejection note: the note was about the version that was
    /// refused, and leaving it attached to the next attempt would show the owner an objection to
    /// text they have already changed.
    /// </remarks>
    public static async Task UpsertAsync(
        SqlConnection conn,
        SqlTransaction tx,
        long listingId,
        long userId,
        ValidListing value,
        int categoryId,
        bool submitForReview,
        CancellationToken ct)
    {
        await using (var clear = new SqlCommand(
            "DELETE FROM dbo.listing_pending_changes WHERE listing_id = @listing", conn, tx))
        {
            clear.Parameters.AddWithValue("listing", listingId);
            await clear.ExecuteNonQueryAsync(ct);
        }

        await using var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_pending_changes
                  (listing_id, status, name, description, address_line, pincode,
                   phone_primary, phone_whatsapp, website_url, category_id,
                   created_by_user_id, submitted_at)
              VALUES (@listing, @status, @name, @description, @address, @pincode,
                      @phone, @whatsapp, @website, @category,
                      @user, CASE WHEN @status = 'draft' THEN NULL ELSE SYSDATETIMEOFFSET() END)",
            conn, tx);
        insert.Parameters.AddWithValue("listing", listingId);
        insert.Parameters.AddWithValue("status", submitForReview ? PendingReview : Draft);
        insert.Parameters.AddWithValue("name", value.Name);
        AddText(insert, "description", value.Description);
        AddText(insert, "address", value.AddressLine);
        AddText(insert, "pincode", value.Pincode);
        insert.Parameters.AddWithValue("phone", value.PhonePrimary);
        AddText(insert, "whatsapp", value.PhoneWhatsapp);
        AddText(insert, "website", value.WebsiteUrl);
        insert.Parameters.AddWithValue("category", categoryId);
        insert.Parameters.AddWithValue("user", userId);
        await insert.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Throws the owner's staged edit away, so the live version is what they see again.</summary>
    public static async Task<bool> DiscardAsync(
        SqlConnection conn, SqlTransaction tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "DELETE FROM dbo.listing_pending_changes WHERE listing_id = @listing", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);
        return await command.ExecuteNonQueryAsync(ct) > 0;
    }

    /// <summary>
    /// Copies a staged edit onto its listing and removes it.
    /// </summary>
    /// <remarks>
    /// The listing's own status is not touched: it was published before the edit and it is published
    /// after. Its <c>review_note</c> is cleared, because any note on it referred to an older
    /// decision and the current text has just been approved.
    ///
    /// The category is set through <see cref="ListingWriter.SetPrimaryCategory"/> rather than by
    /// hand, so a staged category change files the listing the same way every other path does.
    /// </remarks>
    public static async Task ApplyAsync(
        SqlConnection conn, SqlTransaction tx, Staged staged, long adminId, CancellationToken ct)
    {
        await using (var update = new SqlCommand(
            @"UPDATE dbo.listings SET
                  name = COALESCE(@name, name),
                  description = @description,
                  address_line = @address,
                  pincode = @pincode,
                  phone_primary = COALESCE(@phone, phone_primary),
                  phone_whatsapp = @whatsapp,
                  website_url = @website,
                  review_note = NULL,
                  reviewed_at = SYSDATETIMEOFFSET(),
                  reviewed_by_admin_id = @admin,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @listing", conn, tx))
        {
            update.Parameters.AddWithValue("listing", staged.ListingId);
            update.Parameters.AddWithValue("admin", adminId);
            /* COALESCE on the two columns the listing cannot be without: a staged row is written
               from a validated form, so neither should ever be null, and if one somehow is, keeping
               what is published beats publishing a blank name. The optional fields are copied as
               they are -- including null, which is how an owner clears one. */
            AddText(update, "name", staged.Name);
            AddText(update, "description", staged.Description);
            AddText(update, "address", staged.AddressLine);
            AddText(update, "pincode", staged.Pincode);
            AddText(update, "phone", staged.PhonePrimary);
            AddText(update, "whatsapp", staged.PhoneWhatsapp);
            AddText(update, "website", staged.WebsiteUrl);
            await update.ExecuteNonQueryAsync(ct);
        }

        if (staged.CategoryId is { } categoryId)
        {
            await ListingWriter.SetPrimaryCategory(conn, tx, staged.ListingId, categoryId, ct);
        }

        await using var remove = new SqlCommand(
            "DELETE FROM dbo.listing_pending_changes WHERE id = @id", conn, tx);
        remove.Parameters.AddWithValue("id", staged.Id);
        await remove.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Refuses a staged edit, keeping it so its owner can carry on from where they were.
    /// </summary>
    public static async Task RejectAsync(
        SqlConnection conn, SqlTransaction tx, long id, long adminId, string reason, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"UPDATE dbo.listing_pending_changes SET
                  status = 'rejected',
                  review_note = @reason,
                  reviewed_at = SYSDATETIMEOFFSET(),
                  reviewed_by_admin_id = @admin,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("admin", adminId);
        command.Parameters.AddWithValue("reason", reason);
        await command.ExecuteNonQueryAsync(ct);
    }

    private static void AddText(SqlCommand command, string name, string? value) =>
        command.Parameters.AddWithValue(name, (object?)value ?? DBNull.Value);
}
