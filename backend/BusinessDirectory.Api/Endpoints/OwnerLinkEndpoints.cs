using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;
using System.Security.Claims;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// A listing's website and social links, under /api/v1/me/listings/{id}/links.
///
/// <para>
/// <b>Every listing may add as many links as it likes (S0029).</b> They used to be a Verified
/// benefit capped at five -- `link_limit` in `listing_entitlements` read 5 for a paid listing and 0
/// for a free one, and the table backed that up with a CHECK on `sort_order` and a unique index on
/// the slot. All three are gone. What the paid plan buys now is <b>naming</b> them: a free listing's
/// links are stored as `Link 1`, `Link 2`, ... and a Verified one's are whatever the owner calls
/// them.
/// </para>
/// <para>
/// That gate is enforced here rather than in the database, and deliberately so: it is a rule about
/// <i>who may write a value</i>, not about which values are legal, and the column itself has no
/// opinion. A free listing that posts a label gets the generated name instead -- the request is not
/// refused, because the label is not something the free form offers and a 400 would be describing a
/// field the owner never saw.
/// </para>
///
/// Three things are enforced here, each in the API rather than in the UI:
///   * ownership -- every statement joins business_members, so another owner's listing is "not
///     found" rather than "forbidden", which tells a prober nothing;
///   * who may name a link -- read from the listing_entitlements view, never from
///     listings.plan_slug, so a lapsed subscription loses the right to rename on the next request
///     while every link it already saved stays exactly where it is;
///   * the shape of the URL -- http/https only, checked here and again by listing_links_url_shape,
///     so a stored link can never become a javascript: payload in someone's browser.
///
/// The slot is still chosen inside one transaction with the listing row locked: two links added at
/// the same instant must not both read the same MAX and land on the same position.
/// </summary>
public static class OwnerLinkEndpoints
{
    /// <summary>`listing_links.label` is `nvarchar(80)` in S0009. Shared by the add and rename paths.</summary>
    public const int MaxLabelLength = 80;

    /// <summary>The link types listing_links_type_check allows. Kept here so the API can say which
    /// are valid instead of letting the database refuse with a constraint name.</summary>
    private static readonly string[] AllowedTypes =
        ["website", "instagram", "facebook", "youtube", "linkedin", "x", "other"];

    /// <param name="Label">
    /// The label as stored: on a paid listing the owner's own words, on a free one the position the
    /// API gave it. It is kept through a lapse rather than overwritten, so a renewal brings the
    /// owner's names straight back.
    /// </param>
    /// <param name="DisplayLabel">
    /// What a visitor sees. The same as <paramref name="Label"/> while the listing is paid up, and
    /// `Link 1`, `Link 2`, ... while it is not -- so a name chosen under Verified stops being
    /// published when the plan lapses, the way over-allowance media stops being shown (D10),
    /// without the saved name being lost. Staff see the stored label, because they are editing the
    /// record rather than reading the page.
    /// </param>
    public sealed record LinkDto(
        long Id, string LinkType, string Label, string DisplayLabel, string Url, int SortOrder);

    /// <param name="Limit">
    /// <b>Legacy, and deliberately still a number.</b> Before S0029 this was the link allowance: 5
    /// on a paid listing, 0 on a free one, and the websites rendered "{used} of {limit}" and hid
    /// the form at 0 from it. Websites deploy independently of this API, so a build from before
    /// S0029 is still reading this field during a rollout — and `null` would arrive there as 0,
    /// making a paid listing look full at its first link. It therefore keeps the old meaning while
    /// a cap is known, and falls back to the old derived value once there is none.
    ///
    /// Remove it once every deployed website reads <paramref name="Unlimited"/>. Nothing in this
    /// repository reads it any more.
    /// </param>
    /// <param name="Unlimited">
    /// Whether there is no cap at all, which is what `link_limit IS NULL` means (S0029). New
    /// websites read this instead of <paramref name="Limit"/>. False against a database that has
    /// not had S0029 applied yet, where the cap is real and this API still enforces it.
    /// </param>
    /// <param name="CanNameLinks">
    /// Whether this listing may choose its own labels. True on a paid listing; on a free one the API
    /// names each link after its position. This is the "Make your own field" part of the Verified
    /// plan, and the websites read it from here rather than deciding it from the plan slug.
    /// </param>
    /// <param name="PaidUntil">When the paid period ends, or null when there is none.</param>
    public sealed record LinkAllowanceDto(
        string PlanSlug,
        string PlanName,
        int Limit,
        bool Unlimited,
        int Used,
        bool Verified,
        bool CanNameLinks,
        DateTimeOffset? PaidUntil);

    public sealed record LinksDto(LinkAllowanceDto Allowance, List<LinkDto> Items);

    /// <summary>
    /// The staff editor's view of a listing's links (SuperAdminListingContentEndpoints).
    ///
    /// It has a shape of its own rather than reusing
    /// <c>OwnerListingContentEndpoints.CollectionDto</c> because of one field: <paramref name="Limit"/>
    /// is nullable here and that generic's is not. FAQs and content sections still have numeric
    /// allowances, so widening theirs would make every screen that reads one handle a null that
    /// cannot happen. Links are the only unlimited collection (S0029), and this says so in the one
    /// place it is true.
    /// </summary>
    /// <param name="Limit">Null means unlimited, which is every plan once S0029 is applied.</param>
    public sealed record LinkCollectionDto(
        IReadOnlyList<LinkDto> Items, int? Limit, int Used, string PlanName);

    /// <summary>What an owner may change about a link they already have: its name, and nothing else.</summary>
    public sealed record RenameLinkRequest(string? Label);

    public sealed record AddLinkRequest(string? LinkType, string? Label, string? Url);

    /// <summary>A link that has passed <see cref="TryNormalise"/>: trimmed, lower-cased type, known good URL.</summary>
    public sealed record NormalisedLink(string LinkType, string Label, string Url);

    /// <summary>
    /// What a link is called when the listing may not name its own: the position, one-based, so an
    /// owner reads "Link 1, Link 2, Link 3" and can see what upgrading would let them change.
    /// </summary>
    public static string GenericLabel(int slot) =>
        $"Link {(slot + 1).ToString(System.Globalization.CultureInfo.InvariantCulture)}";

    /// <summary>
    /// The label to store. Separated out and public so a test can assert the rule without a
    /// database: it is the whole of what the Verified plan sells here, and a mistake in it either
    /// gives the paid feature away or refuses it to somebody who paid.
    /// </summary>
    public static string LabelToStore(bool canNameLinks, string submittedLabel, int slot) =>
        canNameLinks ? submittedLabel : GenericLabel(slot);

    /// <summary>
    /// What a visitor sees, which is not always what is stored.
    ///
    /// A name chosen under Verified stays in the row when the plan lapses -- deleting it would be
    /// destroying something the owner wrote, and renewing has to bring it back -- but it stops
    /// being published, because naming is the thing that was being paid for. So an unpaid listing's
    /// links read as their position, counted from the order they are shown in rather than from
    /// `sort_order`, which can have gaps after a deletion.
    /// </summary>
    /// <param name="position">Zero-based position in the list as the reader sees it.</param>
    public static string DisplayLabel(bool verified, string storedLabel, int position) =>
        verified ? storedLabel : GenericLabel(position);

    /// <summary>
    /// The legacy `limit` number the response still carries, for websites deployed before S0029.
    ///
    /// While the database still has a cap, that is the honest number. Once it does not, the old
    /// derived value is used -- 5 for a plan that verifies, 0 otherwise -- because that is what an
    /// older website expects to render, and `null` reaching it as 0 would make a paid listing look
    /// full at its first link. See <see cref="LinkAllowanceDto.Limit"/>.
    /// </summary>
    public static int LegacyLimit(int? schemaLimit, bool verified) =>
        schemaLimit ?? (verified ? 5 : 0);

    /// <summary>
    /// Checks and tidies one submitted link, or hands back the field errors.
    ///
    /// Public and shared, because the super-admin staff editor
    /// (SuperAdminListingContentEndpoints) adds links to listings whose owner has no account. Two
    /// implementations of this check is how one of them ends up accepting a `javascript:` URL that
    /// the other refuses — and this is the one rule on the listing page whose output is an
    /// attribute a visitor's browser will follow.
    /// </summary>
    public static bool TryNormalise(
        AddLinkRequest? body,
        out NormalisedLink link,
        out Dictionary<string, string[]> errors)
    {
        errors = [];

        var linkType = body?.LinkType?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(linkType) || !AllowedTypes.Contains(linkType))
        {
            errors["linkType"] = [$"Choose one of: {string.Join(", ", AllowedTypes)}."];
        }

        var label = body?.Label?.Trim();
        if (string.IsNullOrEmpty(label))
        {
            errors["label"] = ["Give the link a short label."];
        }
        else if (label.Length > MaxLabelLength)
        {
            errors["label"] = [$"Keep the label to {MaxLabelLength} characters or fewer."];
        }

        var url = body?.Url?.Trim();
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
            link = new NormalisedLink(string.Empty, string.Empty, string.Empty);
            return false;
        }

        link = new NormalisedLink(linkType!, label!, url!);
        return true;
    }

    public static RouteGroupBuilder MapOwnerLinkEndpoints(this RouteGroupBuilder listings)
    {
        var group = listings.MapGroup("/{id:long}/links");
        group.MapGet("", List);
        group.MapPost("", Add);
        // Renaming is the paid feature, so it is a route of its own rather than a flag on the add.
        group.MapPut("/{linkId:long}", Rename);
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

        return Results.Ok(new LinksDto(
            allowance,
            await ReadLinks(conn, null, id, allowance.Verified, ct)));
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

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        /* The allowance is read before the request is validated, which is a change of order: whether
           the label is the owner's to write depends on the plan, and the plan comes from the
           database. It locks the listing row, so the slot chosen below and the insert cannot
           interleave with another request doing the same thing. */
        var allowance = await ReadAllowance(conn, tx, userId, id, ct);
        if (allowance is null)
        {
            await tx.RollbackAsync(ct);
            return Results.NotFound();
        }

        /* A free listing does not name its links, so it has no label to send and a missing one must
           not read as a validation error. Normalisation still wants a non-empty label, so a
           placeholder stands in for the check and the real position-based name is settled once the
           slot is known. A label sent by a free listing is simply not used. */
        var submitted = body ?? new AddLinkRequest(null, null, null);
        var toValidate = allowance.CanNameLinks ? submitted : submitted with { Label = GenericLabel(0) };

        if (!TryNormalise(toValidate, out var link, out var errors))
        {
            await tx.RollbackAsync(ct);
            return Results.ValidationProblem(errors);
        }

        /* Still enforced when the database still has a cap, which is the whole of this API's
           tolerance for the old schema: S0029 is what makes `link_limit` NULL, and until it is
           applied the table's own CHECK still refuses a sixth link. Accepting one here would turn
           a plan rule into a constraint violation and a 500. With S0029 applied, `Unlimited` is
           true and neither branch runs. */
        if (!allowance.Unlimited)
        {
            if (allowance.Limit == 0)
            {
                await tx.RollbackAsync(ct);
                // The wording the old API used, because against the old schema this is the old rule.
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
        }

        var slot = await NextSlot(conn, tx, id, allowance.Unlimited ? null : allowance.Limit, ct);
        if (slot is null)
        {
            await tx.RollbackAsync(ct);
            return Results.Problem(
                $"This listing already has its {allowance.Limit} links. Remove one first.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var label = LabelToStore(allowance.CanNameLinks, link.Label, slot.Value);

        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.listing_links (listing_id, link_type, label, url, sort_order)
              OUTPUT INSERTED.id
              VALUES (@listing, @type, @label, @url, @slot)", conn, tx))
        {
            insert.Parameters.AddWithValue("listing", id);
            insert.Parameters.AddWithValue("type", link.LinkType);
            insert.Parameters.AddWithValue("label", label);
            insert.Parameters.AddWithValue("url", link.Url);
            insert.Parameters.AddWithValue("slot", slot.Value);

            var newId = (long)(await insert.ExecuteScalarAsync(ct))!;
            await tx.CommitAsync(ct);

            return Results.Created(
                $"/api/v1/me/listings/{id}/links/{newId}",
                /* The new link goes on the end, so its display position is one past what was there
                   -- which for a free listing is also exactly the name it was just given. */
                new LinkDto(
                    newId,
                    link.LinkType,
                    label,
                    DisplayLabel(allowance.Verified, label, allowance.Used),
                    link.Url,
                    slot.Value));
        }
    }

    /// <summary>
    /// Renames a link the listing already has. The paid feature, applied to what is already there.
    ///
    /// <para>
    /// Without this, "make your own field" only ever worked for links added *after* upgrading: an
    /// owner who paid found every existing link still called `Link 1`, with no way to change it
    /// except deleting and re-adding — which also moved it to the end of their public page. That is
    /// the feature not working, so it is a gap rather than a nicety.
    /// </para>
    /// <para>
    /// <b>Only the label changes.</b> `sort_order` is not in the UPDATE at all, so renaming cannot
    /// reorder a listing's links, and neither is `url` or `link_type` — a rename that could quietly
    /// repoint a link would be a different and much more dangerous operation.
    /// </para>
    /// <para>
    /// The entitlement is re-read inside the transaction and the refusal is 402, the same answer the
    /// add path gives for a paid feature on a free plan: a lapsed listing loses the right to rename
    /// on its very next request, while keeping every name it had already chosen.
    /// </para>
    /// </summary>
    private static async Task<IResult> Rename(
        long id,
        long linkId,
        RenameLinkRequest body,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        var label = body?.Label?.Trim();
        if (string.IsNullOrEmpty(label))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["label"] = ["Give the link a short label."],
            });
        }
        if (label.Length > MaxLabelLength)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["label"] = [$"Keep the label to {MaxLabelLength} characters or fewer."],
            });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);

        var allowance = await ReadAllowance(conn, tx, userId, id, ct);
        if (allowance is null)
        {
            await tx.RollbackAsync(ct);
            return Results.NotFound();
        }

        if (!allowance.CanNameLinks)
        {
            await tx.RollbackAsync(ct);
            return Results.Problem(
                "Naming your own link fields is part of the Verified plan.",
                statusCode: StatusCodes.Status402PaymentRequired);
        }

        /* The ownership join is part of the UPDATE, so another owner's link id matches no row and
           answers 404 rather than 403 — the same shape as Delete. */
        int updated;
        await using (var update = new SqlCommand(
            @"UPDATE l
              SET l.label = @label, l.updated_at = SYSDATETIMEOFFSET()
              FROM dbo.listing_links l
              JOIN dbo.listings li ON li.id = l.listing_id
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              WHERE l.id = @link AND l.listing_id = @listing", conn, tx))
        {
            update.Parameters.AddWithValue("user", userId);
            update.Parameters.AddWithValue("link", linkId);
            update.Parameters.AddWithValue("listing", id);
            update.Parameters.AddWithValue("label", label);
            updated = await update.ExecuteNonQueryAsync(ct);
        }

        if (updated == 0)
        {
            await tx.RollbackAsync(ct);
            return Results.NotFound();
        }

        // Read back inside the same transaction, so the response is the row as it now stands rather
        // than what this handler believes it wrote.
        var items = await ReadLinks(conn, tx, id, allowance.Verified, ct);
        await tx.CommitAsync(ct);

        var renamed = items.FirstOrDefault(item => item.Id == linkId);
        return renamed is null ? Results.NotFound() : Results.Ok(renamed);
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
    /// expired listing would keep the right to name its links.
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

        var verified = reader.GetBoolean(3);

        /* Read as a nullable, which is the whole of this API's tolerance for both schemas: NULL is
           S0029's "no limit", a number is the cap a database without S0029 still enforces. Reading
           it with GetInt32, as this file did before S0029, is what would throw a
           SqlNullValueException against the new view — and is why the API has to ship before the
           migration runs. */
        var schemaLimit = await reader.IsDBNullAsync(2, ct) ? null : (int?)reader.GetInt32(2);

        return new LinkAllowanceDto(
            reader.GetString(0),
            reader.GetString(1),
            LegacyLimit(schemaLimit, verified),
            Unlimited: schemaLimit is null,
            (int)reader.GetInt64(5),
            verified,
            // Naming a link is the paid part now, and it is the same answer as the badge.
            verified,
            await reader.IsDBNullAsync(4, ct) ? null : reader.GetDateTimeOffset(4));
    }

    /// <summary>
    /// One listing's links in the order they are shown, with both the stored label and the one a
    /// visitor would see.
    ///
    /// The display position is counted from this list rather than from `sort_order`, which has gaps
    /// once a link has been deleted: a free listing's links must read `Link 1, Link 2, Link 3` with
    /// no missing numbers, whatever slots they happen to occupy.
    /// </summary>
    private static async Task<List<LinkDto>> ReadLinks(
        SqlConnection conn, SqlTransaction? tx, long listingId, bool verified, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            @"SELECT id, link_type, label, url, sort_order
              FROM dbo.listing_links
              WHERE listing_id = @listing
              ORDER BY sort_order, id", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        var items = new List<LinkDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var stored = reader.GetString(2);
            items.Add(new LinkDto(
                reader.GetInt64(0),
                reader.GetString(1),
                stored,
                DisplayLabel(verified, stored, items.Count),
                reader.GetString(3),
                reader.GetInt32(4)));
        }

        return items;
    }

    /// <summary>
    /// The position a new link takes: one past the highest in use, or 0 for the first.
    ///
    /// <para>
    /// It used to hunt for the lowest unoccupied slot below the limit, because
    /// `listing_links_sort_check` capped `sort_order` at 4 and a unique index made each position
    /// unique per listing -- so a link removed from the middle left a gap that had to be reused.
    /// S0029 dropped both, and with an unbounded list the end is the only sensible place to add:
    /// reusing a gap would silently move a new link above older ones.
    /// </para>
    /// <para>
    /// Called with the listing row already locked, so two simultaneous adds cannot read the same
    /// MAX. Ordering is all `sort_order` decides now, and a repeated value no longer fails the
    /// insert, so the worst a race could do is leave two links in an arbitrary order rather than
    /// refuse one.
    /// </para>
    /// </summary>
    /// <param name="cap">
    /// Null when the database has no cap (S0029 applied), and then the slot is simply MAX + 1.
    /// A number when it still has one, and then the old allocator runs: the lowest unoccupied slot
    /// below the cap, because the table's CHECK still refuses a `sort_order` of 5 and its unique
    /// index still refuses a repeat. Returns null when every slot below the cap is taken.
    ///
    /// Both are here because the API has to work against both schemas during a rollout. Picking
    /// MAX + 1 against the old schema would try to write slot 5 and fail the constraint, turning a
    /// plan rule into a 500.
    /// </param>
    public static async Task<int?> NextSlot(
        SqlConnection conn, SqlTransaction tx, long listingId, int? cap, CancellationToken ct)
    {
        if (cap is null)
        {
            await using var highest = new SqlCommand(
                // COALESCE, not ISNULL: MAX over no rows is NULL, and -1 + 1 is the first position.
                @"SELECT COALESCE(MAX(sort_order), -1) + 1
                  FROM dbo.listing_links WHERE listing_id = @listing", conn, tx);
            highest.Parameters.AddWithValue("listing", listingId);
            return (int)(await highest.ExecuteScalarAsync(ct))!;
        }

        await using var command = new SqlCommand(
            @"SELECT sort_order FROM dbo.listing_links WHERE listing_id = @listing", conn, tx);
        command.Parameters.AddWithValue("listing", listingId);

        var taken = new HashSet<int>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct)) taken.Add(reader.GetInt32(0));
        }

        for (var slot = 0; slot < cap.Value; slot++)
        {
            if (!taken.Contains(slot)) return slot;
        }

        return null;
    }
}
