using System.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Listings;

/// <summary>
/// A whole listing, staged: every section of a published listing's proposed next version (S0034).
///
/// A staged edit is a row in <c>listings</c> whose <c>staged_for_listing_id</c> names the published
/// listing it is a proposal for. It holds its own media, opening hours, questions, content sections,
/// amenities and links, copied from the published listing when editing begins. The owner's editor is
/// pointed at it and everything downstream works unchanged — every section's endpoint, every
/// validation, every ownership check, because ownership is <c>business_members</c> and a staged row
/// belongs to the same business as the listing it stands in for.
///
/// It replaced a table of eight columns mirroring eight columns of <c>listings</c>, which staged the
/// Business details form and could not be extended to the other four sections without a parallel
/// copy of five more tables and two code paths in every endpoint that writes one.
///
/// <b>Three rules hold the whole thing up.</b>
/// <list type="number">
/// <item>A staged row may never be <c>active</c> — a CHECK, so no query can serve one publicly,
/// including one written by somebody who has never heard of this column.</item>
/// <item>Every list, count and queue of listings skips staged and placeholder rows.
/// <c>scripts/check-staged-listings.test.mjs</c> fails if a new one forgets.</item>
/// <item>A staged row's entitlement comes from the listing it stands in for, through
/// <c>listing_entitlements</c>. Otherwise a shadow of a Verified listing reads as Free and its owner
/// is told to pay for the photos they already have.</item>
/// </list>
///
/// Every method here takes the caller's transaction. Approving touches eight tables, and a
/// half-applied approval would publish a name without its photos.
/// </summary>
public static class StagedListings
{
    /// <summary>A staged edit, as the owner's screens and the moderator's queue read it.</summary>
    /// <param name="ListingId">The staged row's own id. This is the id the editor writes to.</param>
    /// <param name="PublishedListingId">The listing it is a proposal for.</param>
    public sealed record Staged(
        long ListingId,
        long PublishedListingId,
        string Status,
        string? ReviewNote,
        DateTimeOffset? ReviewedAt,
        DateTimeOffset UpdatedAt);

    /// <summary>
    /// The child tables a staged listing copies, in the order they are written.
    /// </summary>
    /// <remarks>
    /// Named here rather than inline so that adding a sixth section to the editor is one entry and
    /// two column lists, and so the copy, the replace and the delete can never disagree about which
    /// tables make up "a listing". The order matters only for readability: each is independent.
    /// </remarks>
    private static readonly (string Table, string Columns)[] ChildTables =
    [
        ("dbo.listing_categories", "category_id, category_level, is_primary"),
        ("dbo.listing_media", "kind, storage_key, content_type, byte_size, width, height, sort_order, is_hidden, created_by_user_id"),
        ("dbo.listing_opening_hours", "day_of_week, opens_at, closes_at"),
        ("dbo.listing_faqs", "question, answer, sort_order"),
        ("dbo.listing_content_sections", "heading, body, sort_order"),
        ("dbo.listing_attributes", "kind, label, sort_order"),
        ("dbo.listing_links", "link_type, label, url, sort_order"),
    ];

    /// <summary>The staged edit waiting on a published listing, or null when there is none.</summary>
    public static async Task<Staged?> ForListingAsync(
        SqlConnection conn, SqlTransaction? tx, long publishedListingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT id, staged_for_listing_id, status, review_note, reviewed_at, updated_at
              FROM dbo.listings
              WHERE staged_for_listing_id = @published", conn, tx);
        command.Parameters.AddWithValue("published", publishedListingId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct)
            ? new Staged(
                reader.GetInt64(0),
                reader.GetInt64(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<DateTimeOffset>(4),
                reader.GetFieldValue<DateTimeOffset>(5))
            : null;
    }

    /// <summary>Every staged edit belonging to one owner, keyed by the listing it stands in for.</summary>
    public static async Task<Dictionary<long, Staged>> ForOwnerAsync(
        SqlConnection conn, SqlTransaction? tx, long userId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT s.id, s.staged_for_listing_id, s.status, s.review_note, s.reviewed_at, s.updated_at
              FROM dbo.listings s
              JOIN dbo.business_members bm ON bm.business_id = s.business_id AND bm.user_id = @user
              WHERE s.staged_for_listing_id IS NOT NULL", conn, tx);
        command.Parameters.AddWithValue("user", userId);

        var staged = new Dictionary<long, Staged>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            staged[reader.GetInt64(1)] = new Staged(
                reader.GetInt64(0),
                reader.GetInt64(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<DateTimeOffset>(4),
                reader.GetFieldValue<DateTimeOffset>(5));
        }
        return staged;
    }

    /// <summary>
    /// Takes a complete copy of a published listing for its owner to edit.
    /// </summary>
    /// <remarks>
    /// The copy includes every child row, so the owner opens their own version of the listing rather
    /// than an empty form: removing a photo or an opening time is then an edit to the copy, and the
    /// published listing keeps all of them until the copy is approved.
    ///
    /// <b>The blob behind a copied photo is not copied.</b> Both rows point at the same storage key,
    /// which is why deleting a media row only deletes its file when no other row still references it
    /// — see <c>OwnerMediaEndpoints</c>. Copying tens of megabytes to open an editor would be the
    /// wrong trade, and a shared key is the thing that makes "keep the published photo, drop it from
    /// my draft" work.
    ///
    /// The slug is derived from the published listing's id and the clock. It is never shown: a
    /// staged row has no public page, and its slug exists only because the column is NOT NULL and
    /// unique within a locality.
    /// </remarks>
    public static async Task<long> CreateAsync(
        SqlConnection conn, SqlTransaction tx, long publishedListingId, long userId, CancellationToken ct)
    {
        long shadowId;
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.listings
                  (business_id, locality_id, slug, name, description, address_line, pincode,
                   location, phone_primary, phone_whatsapp, email, website_url,
                   status, source, created_by_user_id, plan_slug, staged_for_listing_id)
              OUTPUT INSERTED.id
              SELECT li.business_id, li.locality_id,
                     CONCAT('staged-', CAST(li.id AS varchar(20)), '-',
                            CAST(DATEDIFF(second, '2020-01-01', SYSUTCDATETIME()) AS varchar(20))),
                     li.name, li.description, li.address_line, li.pincode,
                     li.location, li.phone_primary, li.phone_whatsapp, li.email, li.website_url,
                     'draft', li.source, @user, li.plan_slug, li.id
              FROM dbo.listings li
              WHERE li.id = @published", conn, tx))
        {
            insert.Parameters.AddWithValue("published", publishedListingId);
            insert.Parameters.AddWithValue("user", userId);
            shadowId = (long)(await insert.ExecuteScalarAsync(ct))!;
        }

        foreach (var (table, columns) in ChildTables)
        {
            await using var copy = new SqlCommand(
                $@"INSERT INTO {table} (listing_id, {columns})
                   SELECT @shadow, {columns} FROM {table} WHERE listing_id = @published", conn, tx);
            copy.Parameters.AddWithValue("shadow", shadowId);
            copy.Parameters.AddWithValue("published", publishedListingId);
            await copy.ExecuteNonQueryAsync(ct);
        }

        return shadowId;
    }

    /// <summary>
    /// Publishes a staged listing: its values and all of its children replace the published ones.
    /// </summary>
    /// <remarks>
    /// In one transaction, and in this order: the published listing's children are deleted, the
    /// staged listing's children are *moved* onto it, the staged values are copied over, and the
    /// staged row is deleted. Moving rather than copying keeps each media row's storage key, so no
    /// file is re-uploaded and no URL changes for a photo that was already there.
    ///
    /// <b>The slug is not copied.</b> It is the listing's public address, and changing it would break
    /// every link and search result pointing at the listing — which is why the editor has never
    /// offered to change it and why `slug_history` exists for the cases where staff do.
    ///
    /// The published listing's status is not touched either: it was on the site before the edit and
    /// it is on the site after. Its review note is cleared, because any note on it was about an
    /// older decision and this text has just been approved.
    ///
    /// Returns the storage keys that no row references any more, so the caller can delete those
    /// files after the transaction commits. Deleting them inside it would mean a rolled-back
    /// approval had already destroyed a photo.
    /// </remarks>
    public static async Task<List<string>> ApproveAsync(
        SqlConnection conn,
        SqlTransaction tx,
        long stagedListingId,
        long publishedListingId,
        long adminId,
        CancellationToken ct)
    {
        /* Which files the published listing holds now. After the move, any of these that no row
           points at is a photo the owner removed, and its file is nobody's. */
        var keysBefore = await StorageKeysAsync(conn, tx, publishedListingId, ct);

        foreach (var (table, columns) in ChildTables)
        {
            await using (var clear = new SqlCommand(
                $"DELETE FROM {table} WHERE listing_id = @published", conn, tx))
            {
                clear.Parameters.AddWithValue("published", publishedListingId);
                await clear.ExecuteNonQueryAsync(ct);
            }

            await using var move = new SqlCommand(
                $"UPDATE {table} SET listing_id = @published WHERE listing_id = @staged", conn, tx);
            move.Parameters.AddWithValue("published", publishedListingId);
            move.Parameters.AddWithValue("staged", stagedListingId);
            await move.ExecuteNonQueryAsync(ct);
        }

        await using (var publish = new SqlCommand(
            @"UPDATE published
              SET name = staged.name,
                  description = staged.description,
                  address_line = staged.address_line,
                  pincode = staged.pincode,
                  phone_primary = staged.phone_primary,
                  phone_whatsapp = staged.phone_whatsapp,
                  email = staged.email,
                  website_url = staged.website_url,
                  location = staged.location,
                  review_note = NULL,
                  reviewed_at = SYSDATETIMEOFFSET(),
                  reviewed_by_admin_id = @admin,
                  updated_at = SYSDATETIMEOFFSET()
              FROM dbo.listings published
              JOIN dbo.listings staged ON staged.id = @staged
              WHERE published.id = @published", conn, tx))
        {
            publish.Parameters.AddWithValue("published", publishedListingId);
            publish.Parameters.AddWithValue("staged", stagedListingId);
            publish.Parameters.AddWithValue("admin", adminId);
            await publish.ExecuteNonQueryAsync(ct);
        }

        /* The staged row, now childless: every child was moved a moment ago, so the cascades on it
           have nothing left to take. */
        await using (var remove = new SqlCommand("DELETE FROM dbo.listings WHERE id = @staged", conn, tx))
        {
            remove.Parameters.AddWithValue("staged", stagedListingId);
            await remove.ExecuteNonQueryAsync(ct);
        }

        var keysAfter = await StorageKeysAsync(conn, tx, publishedListingId, ct);
        return await UnreferencedAsync(conn, tx, keysBefore.Except(keysAfter).ToList(), ct);
    }

    /// <summary>
    /// Refuses a staged listing and keeps it, so its owner carries on from their own work.
    /// </summary>
    /// <remarks>
    /// Nothing about the published listing changes — not its values, not its children, not its
    /// status. That is the half of this feature that is easy to get wrong and impossible to notice:
    /// a refusal that touched the live page would mean a moderator saying "no" had published
    /// something.
    /// </remarks>
    public static async Task RejectAsync(
        SqlConnection conn, SqlTransaction tx, long stagedListingId, long adminId, string reason, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"UPDATE dbo.listings
              SET status = 'rejected',
                  review_note = @reason,
                  reviewed_at = SYSDATETIMEOFFSET(),
                  reviewed_by_admin_id = @admin,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @staged AND staged_for_listing_id IS NOT NULL", conn, tx);
        command.Parameters.AddWithValue("staged", stagedListingId);
        command.Parameters.AddWithValue("admin", adminId);
        command.Parameters.Add(new SqlParameter("reason", SqlDbType.NVarChar) { Value = reason });
        await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Throws a staged listing away, so the owner's screens show the published version again.
    /// </summary>
    /// <remarks>
    /// Returns the storage keys that nothing references afterwards, for the caller to delete once
    /// the transaction has committed. A photo the owner uploaded only to their draft is theirs and
    /// goes with it; a photo copied from the published listing is still referenced by that listing's
    /// own row, so it is not in the list — which is the whole reason the copy shares a key.
    /// </remarks>
    public static async Task<List<string>> DiscardAsync(
        SqlConnection conn, SqlTransaction tx, long stagedListingId, CancellationToken ct)
    {
        var keys = await StorageKeysAsync(conn, tx, stagedListingId, ct);

        await using (var remove = new SqlCommand(
            "DELETE FROM dbo.listings WHERE id = @staged AND staged_for_listing_id IS NOT NULL", conn, tx))
        {
            remove.Parameters.AddWithValue("staged", stagedListingId);
            await remove.ExecuteNonQueryAsync(ct);
        }

        return await UnreferencedAsync(conn, tx, keys, ct);
    }

    // ---------------------------------------------------------------- placeholders
    /// <summary>
    /// The owner's unsaved new listing, or a fresh one.
    /// </summary>
    /// <remarks>
    /// This is what lets somebody adding a business fill all five sections before saving anything:
    /// a photo, an opening time and a question all belong to a listing, so the listing exists from
    /// the moment they press Add. It is a draft — invisible to the public by the same rule as every
    /// other draft — and it is marked as a placeholder, which keeps it out of the five-listing limit,
    /// labels it honestly in their list, and makes it reusable.
    ///
    /// <b>Clicking Add twice does not make two.</b> The unique filtered index on
    /// <c>created_by_user_id WHERE is_placeholder = 1</c> makes that impossible even under a double
    /// submit; this returns the existing one. The first save clears the flag and it becomes an
    /// ordinary draft.
    ///
    /// The name is a placeholder too, because <c>listings_name_not_blank</c> does not allow an empty
    /// one and inventing a blank-looking name would mean the owner's first job is deleting it.
    /// </remarks>
    public static async Task<long> GetOrCreatePlaceholderAsync(
        SqlConnection conn,
        SqlTransaction tx,
        long userId,
        long businessId,
        int localityId,
        string phone,
        CancellationToken ct)
    {
        await using (var existing = new SqlCommand(
            @"SELECT TOP (1) id FROM dbo.listings WITH (UPDLOCK, HOLDLOCK)
              WHERE created_by_user_id = @user AND is_placeholder = 1", conn, tx))
        {
            existing.Parameters.AddWithValue("user", userId);
            if (await existing.ExecuteScalarAsync(ct) is long found)
            {
                return found;
            }
        }

        await using var insert = new SqlCommand(
            /* The locality's own centre as the map point: a listing needs one, the owner has not
               told us an address yet, and the area they chose is the best answer available. It is
               replaced when they save an address, exactly as it is for a listing created the old
               way. */
            @"INSERT INTO dbo.listings
                  (business_id, locality_id, slug, name, location, phone_primary,
                   status, source, created_by_user_id, is_placeholder)
              OUTPUT INSERTED.id
              SELECT @business, lo.id,
                     CONCAT('new-', CAST(@user AS varchar(20)), '-',
                            CAST(DATEDIFF(second, '2020-01-01', SYSUTCDATETIME()) AS varchar(20))),
                     N'New business', lo.center, @phone,
                     'draft', 'owner', @user, 1
              FROM dbo.localities lo
              WHERE lo.id = @locality", conn, tx);
        insert.Parameters.AddWithValue("business", businessId);
        insert.Parameters.AddWithValue("locality", localityId);
        insert.Parameters.AddWithValue("user", userId);
        insert.Parameters.Add(new SqlParameter("phone", SqlDbType.VarChar) { Value = phone });
        return (long)(await insert.ExecuteScalarAsync(ct))!;
    }

    /// <summary>
    /// Marks a listing as saved for real, so it stops being a placeholder.
    /// </summary>
    /// <remarks>
    /// Called by the owner's create-or-update path on every save. It is a no-op for a listing that
    /// was never a placeholder, which is why it can be called unconditionally rather than by a
    /// caller having to know.
    /// </remarks>
    public static async Task ClearPlaceholderAsync(
        SqlConnection conn, SqlTransaction tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"UPDATE dbo.listings
              SET is_placeholder = 0, updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id AND is_placeholder = 1", conn, tx);
        command.Parameters.AddWithValue("id", listingId);
        await command.ExecuteNonQueryAsync(ct);
    }

    // ---------------------------------------------------------------- files
    private static async Task<List<string>> StorageKeysAsync(
        SqlConnection conn, SqlTransaction tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "SELECT storage_key FROM dbo.listing_media WHERE listing_id = @listing", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        var keys = new List<string>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            keys.Add(reader.GetString(0));
        }
        return keys;
    }

    /// <summary>
    /// Of these storage keys, the ones no media row points at any more.
    /// </summary>
    /// <remarks>
    /// A staged listing's copied photo shares its key with the published listing's row, so "is this
    /// file still needed?" is a question about rows and not about listings. Asking it one key at a
    /// time is fine: this runs for a handful of keys when an edit is approved or discarded, never in
    /// a loop over the directory.
    /// </remarks>
    public static async Task<List<string>> UnreferencedAsync(
        SqlConnection conn, SqlTransaction tx, IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        var orphans = new List<string>();
        foreach (var key in keys.Distinct(StringComparer.Ordinal))
        {
            await using var command = new SqlCommand(
                "SELECT TOP (1) 1 FROM dbo.listing_media WHERE storage_key = @key", conn, tx);
            command.Parameters.Add(new SqlParameter("key", SqlDbType.NVarChar) { Value = key });
            if (await command.ExecuteScalarAsync(ct) is null)
            {
                orphans.Add(key);
            }
        }
        return orphans;
    }
}
