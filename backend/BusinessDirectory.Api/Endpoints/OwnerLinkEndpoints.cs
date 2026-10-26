using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;
using System.Security.Claims;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// A listing's website and social links, under /api/v1/me/listings/{id}/links.
///
/// The Verified plan buys up to five links across website, Instagram, Facebook, YouTube, LinkedIn
/// and X; the Free plan gets none. S0009 created the table and the cap, and nothing read or wrote it
/// until this file, so the allowance the owner was being sold was unreachable.
///
/// Three things are enforced here, each in the API rather than in the UI:
///   * ownership -- every statement joins business_members, so another owner's listing is "not
///     found" rather than "forbidden", which tells a prober nothing;
///   * the allowance -- read from the listing_entitlements view, never from listings.plan_slug, so a
///     lapsed subscription loses its links allowance on the very next request;
///   * the shape of the URL -- http/https only, checked here and again by listing_links_url_shape,
///     so a stored link can never become a javascript: payload in someone's browser.
///
/// The slot is chosen and the count checked inside one transaction with the listing row locked, the
/// same way media uploads do it: two links added at once must not both take the last free slot.
/// </summary>
public static class OwnerLinkEndpoints
{
    /// <summary>The link types listing_links_type_check allows. Kept here so the API can say which
    /// are valid instead of letting the database refuse with a constraint name.</summary>
    private static readonly string[] AllowedTypes =
        ["website", "instagram", "facebook", "youtube", "linkedin", "x", "other"];

    public sealed record LinkDto(long Id, string LinkType, string Label, string Url, int SortOrder);

    /// <param name="Limit">5 on a paid listing, 0 on a free one.</param>
    /// <param name="PaidUntil">When the paid period ends, or null when there is none.</param>
    public sealed record LinkAllowanceDto(
        string PlanSlug,
        string PlanName,
        int Limit,
        int Used,
        bool Verified,
        DateTimeOffset? PaidUntil);

    public sealed record LinksDto(LinkAllowanceDto Allowance, List<LinkDto> Items);

    public sealed record AddLinkRequest(string? LinkType, string? Label, string? Url);

    public static RouteGroupBuilder MapOwnerLinkEndpoints(this RouteGroupBuilder listings)
    {
        var group = listings.MapGroup("/{id:long}/links");
        group.MapGet("", List);
        group.MapPost("", Add);
        group.MapDelete("/{linkId:long}", Delete);
        return listings;
    }

    private static async Task<IResult> List(long id, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);

        var allowance = await ReadAllowance(conn, null, userId, id, ct);
        if (allowance is null)
        {
            return Results.NotFound();
        }

        return Results.Ok(new LinksDto(allowance, await ReadLinks(conn, null, id, ct)));
    }

    private static async Task<IResult> Add(
        long id,
        AddLinkRequest body,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        var errors = new Dictionary<string, string[]>();

        var linkType = body.LinkType?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(linkType) || !AllowedTypes.Contains(linkType))
        {
            errors["linkType"] = [$"Choose one of: {string.Join(", ", AllowedTypes)}."];
        }

        var label = body.Label?.Trim();
        if (string.IsNullOrEmpty(label))
        {
            errors["label"] = ["Give the link a short label."];
        }
        else if (label.Length > 80)
        {
            errors["label"] = ["Keep the label to 80 characters or fewer."];
        }

        var url = body.Url?.Trim();
        if (string.IsNullOrEmpty(url))
        {
            errors["url"] = ["Enter the web address."];
        }
        else if (url.Length > 1000)
        {
            errors["url"] = ["That web address is too long."];
        }
        else if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed)
                 || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        {
            // Parsed rather than pattern-matched, so "https:/x" and "javascript:alert(1)" are both
            // refused here and never reach the database.
            errors["url"] = ["Enter a full web address starting with http:// or https://."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        // Locks the listing row, so the count below and the insert cannot interleave with another
        // request doing the same thing.
        var allowance = await ReadAllowance(conn, tx, userId, id, ct);
        if (allowance is null)
        {
            await tx.RollbackAsync(ct);
            return Results.NotFound();
        }

        if (allowance.Limit == 0)
        {
            await tx.RollbackAsync(ct);
            return Results.Problem(
                "Website and social links are part of the Verified plan.",
                statusCode: StatusCodes.Status402PaymentRequired);
        }

        if (allowance.Used >= allowance.Limit)
        {
            await tx.RollbackAsync(ct);
            return Results.Problem(
                $"This listing already has its {allowance.Limit} links. Remove one first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        // The lowest free slot, not "used count": a link removed from the middle leaves a gap, and
        // listing_links_slot_idx would refuse a second link at an occupied position.
        var slot = await NextFreeSlot(conn, tx, id, allowance.Limit, ct);
        if (slot is null)
        {
            await tx.RollbackAsync(ct);
            return Results.Problem(
                $"This listing already has its {allowance.Limit} links. Remove one first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
              OUTPUT INSERTED.id
              VALUES (@listing, @type, @label, @url, @slot)", conn, tx))
        {
            insert.Parameters.AddWithValue("listing", id);
            insert.Parameters.AddWithValue("type", linkType!);
            insert.Parameters.AddWithValue("label", label!);
            insert.Parameters.AddWithValue("url", url!);
            insert.Parameters.AddWithValue("slot", slot.Value);

            var newId = (long)(await insert.ExecuteScalarAsync(ct))!;
            await tx.CommitAsync(ct);

            return Results.Created(
                $"/api/v1/me/listings/{id}/links/{newId}",
                new LinkDto(newId, linkType!, label!, url!, slot.Value));
        }
    }

    private static async Task<IResult> Delete(
        long id, long linkId, ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var conn = await db.OpenConnectionAsync(ct);

        // The ownership join is part of the DELETE, so another owner's link id matches no row and
        // answers 404 rather than 403.
        await using var command = new SqlCommand(
            @"DELETE l
              FROM dbo.listing_links l
              JOIN dbo.listings li ON li.id = l.listing_id
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              WHERE l.id = @link AND l.listing_id = @listing", conn);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("link", linkId);
        command.Parameters.AddWithValue("listing", id);

        var removed = await command.ExecuteNonQueryAsync(ct);
        return removed == 0 ? Results.NotFound() : Results.NoContent();
    }

    /// <summary>
    /// What this listing is allowed right now, or null when it is not this owner's listing.
    ///
    /// The limit comes from listing_entitlements, which derives it from an active subscription's
    /// expires_at compared against the clock. Reading listings.plan_slug here instead is how an
    /// expired listing would keep showing five links.
    /// </summary>
    private static async Task<LinkAllowanceDto?> ReadAllowance(
        SqlConnection conn, SqlTransaction? tx, long userId, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT e.effective_plan_slug, e.effective_plan_name, e.link_limit, e.is_verified, e.paid_until,
                     (SELECT COUNT_BIG(*) FROM dbo.listing_links l WHERE l.listing_id = li.id)
              FROM dbo.listings li" + (tx is null ? "" : " WITH (UPDLOCK, ROWLOCK)") + @"
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              JOIN dbo.listing_entitlements e ON e.listing_id = li.id
              WHERE li.id = @listing AND li.status <> 'archived'", conn, tx);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("listing", listingId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new LinkAllowanceDto(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetInt32(2),
            (int)reader.GetInt64(5),
            reader.GetBoolean(3),
            await reader.IsDBNullAsync(4, ct) ? null : reader.GetDateTimeOffset(4));
    }

    private static async Task<List<LinkDto>> ReadLinks(
        SqlConnection conn, SqlTransaction? tx, long listingId, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT id, link_type, label, url, sort_order
              FROM dbo.listing_links
              WHERE listing_id = @listing
              ORDER BY sort_order", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        var items = new List<LinkDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new LinkDto(
                reader.GetInt64(0), reader.GetString(1), reader.GetString(2),
                reader.GetString(3), reader.GetInt32(4)));
        }

        return items;
    }

    /// <summary>
    /// The lowest unoccupied sort_order below the limit, or null when every slot is taken.
    /// listing_links_sort_check caps sort_order at 4 and listing_links_slot_idx makes each slot
    /// unique per listing, so picking a free one rather than counting rows is what keeps an insert
    /// from colliding after a link in the middle has been removed.
    /// </summary>
    private static async Task<int?> NextFreeSlot(
        SqlConnection conn, SqlTransaction tx, long listingId, int limit, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT sort_order FROM dbo.listing_links WHERE listing_id = @listing", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        var taken = new HashSet<int>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct)) taken.Add(reader.GetInt32(0));
        }

        for (var slot = 0; slot < limit; slot++)
        {
            if (!taken.Contains(slot)) return slot;
        }

        return null;
    }
}
