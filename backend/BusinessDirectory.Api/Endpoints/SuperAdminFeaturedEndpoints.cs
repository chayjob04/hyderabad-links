using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// The homepage Featured shelf, under /api/v1/super-admin/listings.
///
/// Featured used to mean "has a paid Verified period running", which made the shelf a list of
/// whoever had paid. It is now a decision somebody makes and signs their name to, which is what the
/// owner asked for on 2026-10-27.
///
/// Super-admin only, on purpose. Choosing who the platform recommends on its own front page is not
/// moderation: it is the one shelf a business would ask or pay to be on, so it sits behind
/// <c>listings.feature</c>, which the ordinary admin role does not hold (S0017 asserts that).
///
/// Trending is next to it on the same page and has no endpoint here at all, because nobody may
/// choose it. It is counted from enquiries, favourites and approved reviews in the last 30 days,
/// at read time. A homepage where one shelf is curated and the other is earned only works if the
/// earned one cannot be touched.
/// </summary>
public static class SuperAdminFeaturedEndpoints
{
    /// <summary>
    /// How many listings may be featured at once. The shelf shows eight, and allowing fifty to be
    /// marked would mean the eight that appear were chosen by <c>featured_at</c> order rather than by
    /// anyone — a curated shelf whose contents nobody picked.
    /// </summary>
    public const int MaxFeatured = 8;

    public sealed record FeaturedRowDto(
        long Id,
        string Name,
        string Status,
        string? Url,
        DateTimeOffset FeaturedAt,
        /// <summary>Who chose it. Null when that admin account has since been removed.</summary>
        string? FeaturedBy);

    public sealed record FeaturedListDto(
        IReadOnlyList<FeaturedRowDto> Items,
        int Max,
        /// <summary>So the UI can disable the button rather than offer an action that will be refused.</summary>
        int Remaining);

    public sealed record ShelfFullDto(string Message, int Max);

    public static RouteGroupBuilder MapSuperAdminFeaturedEndpoints(this RouteGroupBuilder listings)
    {
        // "featured" is a fixed segment, so it cannot collide with the "/{id:long}" routes beside it.
        listings.MapGet("/featured", List);
        listings.MapPut("/{id:long}/featured", Feature);
        listings.MapPut("/{id:long}/featured/group/{groupId:int}", FeatureInGroup);
        listings.MapDelete("/{id:long}/featured", Unfeature);
        return listings;
    }

    private static async Task<AdminIdentity?> Authorized(SqlDatabase db, ClaimsPrincipal principal, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        return admin is not null && AdminAccess.AuthorizeSuper(admin, AdminPermissions.ListingsFeature) is null
            ? admin
            : null;
    }

    /// <summary>
    /// What is on the shelf now, newest choice first — the same order the homepage uses, so this
    /// screen shows the shelf as visitors see it.
    /// </summary>
    private static async Task<IResult> List(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (await Authorized(db, principal, ct) is null)
        {
            return Results.Problem("You do not have permission to do that.", statusCode: StatusCodes.Status403Forbidden);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var command = new SqlCommand(
            @"SELECT li.id, li.name, li.status, li.slug, pc.slug, pcparent.slug, li.featured_at, fa.display_name
              FROM dbo.listings li
              LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              LEFT JOIN dbo.categories pc ON pc.id = lc.category_id
              LEFT JOIN dbo.categories pcparent ON pcparent.id = pc.parent_id
              LEFT JOIN dbo.admin_users fa ON fa.id = li.featured_by_admin_id
              WHERE li.featured_at IS NOT NULL
              ORDER BY li.featured_at DESC, li.id", conn);

        var items = new List<FeaturedRowDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new FeaturedRowDto(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                PublicUrl.ForListing(
                    reader.IsDBNull(5) ? null : reader.GetString(5),
                    reader.IsDBNull(4) ? null : reader.GetString(4),
                    reader.GetString(3)),
                reader.GetDateTimeOffset(6),
                reader.IsDBNull(7) ? null : reader.GetString(7)));
        }

        return Results.Ok(new FeaturedListDto(items, MaxFeatured, Math.Max(0, MaxFeatured - items.Count)));
    }

    /// <summary>Features a listing on the default shelf.</summary>
    private static Task<IResult> Feature(
        long id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        FeatureCore(id, null, principal, http, db, ct);

    /// <summary>
    /// Features a listing on a named shelf. A groupId of 0 means the default shelf, so one route
    /// can move a listing between groups and back again without a second verb.
    /// </summary>
    private static Task<IResult> FeatureInGroup(
        long id, int groupId, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct) =>
        FeatureCore(id, groupId == 0 ? null : groupId, principal, http, db, ct);

    private static async Task<IResult> FeatureCore(
        long id, int? groupId, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var admin = await Authorized(db, principal, ct);
        if (admin is null)
        {
            return Results.Problem("You do not have permission to do that.", statusCode: StatusCodes.Status403Forbidden);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        /* Locked, and the count taken inside the same transaction, so two people filling the last
           slot at once cannot both succeed and put nine on an eight-slot shelf. */
        string status;
        bool alreadyFeatured;
        await using (var load = new SqlCommand(
            @"SELECT li.status, CASE WHEN li.featured_at IS NULL THEN 0 ELSE 1 END
              FROM dbo.listings li WITH (UPDLOCK, ROWLOCK)
              WHERE li.id = @id", conn, tx))
        {
            load.Parameters.AddWithValue("id", id);
            await using var reader = await load.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.NotFound();
            }
            status = reader.GetString(0);
            alreadyFeatured = reader.GetInt32(1) == 1;
        }

        /* Only a live listing may be featured. A draft or a listing still in review has no public
           page, so featuring it would put a card on the homepage that 404s; a suspended one was
           taken down on purpose, and recommending it would undo that decision from another screen. */
        if (status != "active")
        {
            return Results.Problem(
                $"Only a live listing can be featured. This one is {status.Replace('_', ' ')}.",
                statusCode: StatusCodes.Status409Conflict);
        }

        if (!alreadyFeatured)
        {
            await using var count = new SqlCommand(
                "SELECT COUNT_BIG(*) FROM dbo.listings WHERE featured_at IS NOT NULL", conn, tx);
            if ((long)(await count.ExecuteScalarAsync(ct))! >= MaxFeatured)
            {
                // Refused rather than silently dropping whichever one is oldest: which business comes
                // off the homepage is a decision, not a side effect of adding another.
                return Results.Json(
                    new ShelfFullDto(
                        $"The Featured shelf already holds {MaxFeatured} listings. Remove one first.", MaxFeatured),
                    statusCode: StatusCodes.Status409Conflict);
            }
        }

        /* Re-featuring an already-featured listing moves it to the front of the shelf, which is the
           only reordering control there is and the reason featured_at is a timestamp. */
        await using (var update = new SqlCommand(
            @"UPDATE dbo.listings
              SET featured_at = SYSDATETIMEOFFSET(), featured_by_admin_id = @admin,
                  homepage_group_id = @group,
                  updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id", conn, tx))
        {
            update.Parameters.AddWithValue("admin", admin.Id);
            update.Parameters.AddWithValue("group", (object?)groupId ?? DBNull.Value);
            update.Parameters.AddWithValue("id", id);
            await update.ExecuteNonQueryAsync(ct);
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.featured", "listing", id.ToString(), http,
            new { refeatured = alreadyFeatured, groupId }, ct);

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Unfeature(
        long id, ClaimsPrincipal principal, HttpContext http, SqlDatabase db, CancellationToken ct)
    {
        var admin = await Authorized(db, principal, ct);
        if (admin is null)
        {
            return Results.Problem("You do not have permission to do that.", statusCode: StatusCodes.Status403Forbidden);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        int affected;
        await using (var update = new SqlCommand(
            @"UPDATE dbo.listings
              SET featured_at = NULL, featured_by_admin_id = NULL, updated_at = SYSDATETIMEOFFSET()
              WHERE id = @id AND featured_at IS NOT NULL", conn, tx))
        {
            update.Parameters.AddWithValue("id", id);
            affected = await update.ExecuteNonQueryAsync(ct);
        }

        // Nothing changed: either there is no such listing or it was not featured. Either way the
        // caller's intent is already true, so this is not an error — and it makes the button safe to
        // press twice.
        if (affected == 0)
        {
            return Results.NoContent();
        }

        await AuditLog.WriteAsync(
            conn, tx, admin.Id, "listing.unfeatured", "listing", id.ToString(), http, new { }, ct);

        await tx.CommitAsync(ct);
        return Results.NoContent();
    }
}
