using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using BusinessDirectory.Api.Notifications;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Sending an owner a correction request, on both staff surfaces.
///
/// One file, two mappings. An admin and a super admin do the same thing here — write to the owner
/// and leave the listing up — so the handler is shared and only the gate differs:
///
///   * <c>/api/v1/admin/listings/{id}/alerts</c> needs <c>listings.alert</c>, which the admin role
///     holds. This is the point of the feature: the moderator who spots the wrong phone number can
///     ask for it to be fixed instead of rejecting the business off the site.
///   * <c>/api/v1/super-admin/listings/{id}/alerts</c> needs <c>listings.edit</c>, which is already
///     reserved for that surface and already means full control of a listing. A second super-admin
///     permission for "may write to an owner" would be a distinction without a difference, since
///     anyone who can rewrite the listing outright can certainly ask the owner to.
///
/// The surfaces are kept apart by <see cref="AdminAccess.Authorize"/> and
/// <see cref="AdminAccess.AuthorizeSuper"/>, which each refuse a permission belonging to the other
/// surface — so this file cannot accidentally make either route reachable with the wrong token.
/// </summary>
public static class ListingAlertEndpoints
{
    public sealed record SendAlertRequest(string? Reason, string? Message);

    public sealed record AlertsDto(
        IReadOnlyList<ListingAlerts.AlertDto> Items,
        /// <summary>The reasons the UI offers, so the form is built from the same list the API validates against.</summary>
        IReadOnlyDictionary<string, string> Reasons);

    /// <summary>
    /// Which surface a request arrived on: the permission to check, how to check it, and what the
    /// audit row should say. Everything else about sending an alert is identical.
    /// </summary>
    private sealed record Surface(
        string Permission,
        Func<AdminIdentity, string, IResult?> Authorize,
        string AuditAction);

    private static readonly Surface AdminSurface = new(
        AdminPermissions.ListingsAlert, AdminAccess.Authorize, "listing.alert_sent");

    private static readonly Surface SuperSurface = new(
        AdminPermissions.ListingsEdit, AdminAccess.AuthorizeSuper, "listing.alert_sent_by_super_admin");

    public static RouteGroupBuilder MapAdminListingAlertEndpoints(this RouteGroupBuilder listings)
    {
        listings.MapGet("/{id:long}/alerts", (long id, ClaimsPrincipal p, SqlDatabase db, CancellationToken ct) =>
            List(id, p, db, AdminSurface with { Permission = AdminPermissions.ListingsView }, ct));
        listings.MapPost("/{id:long}/alerts", (
            long id, SendAlertRequest request, ClaimsPrincipal p, HttpContext http, SqlDatabase db,
            Notifier notifier, CancellationToken ct) =>
            Send(id, request, p, http, db, notifier, AdminSurface, ct));
        return listings;
    }

    public static RouteGroupBuilder MapSuperAdminListingAlertEndpoints(this RouteGroupBuilder listings)
    {
        listings.MapGet("/{id:long}/alerts", (long id, ClaimsPrincipal p, SqlDatabase db, CancellationToken ct) =>
            List(id, p, db, SuperSurface, ct));
        listings.MapPost("/{id:long}/alerts", (
            long id, SendAlertRequest request, ClaimsPrincipal p, HttpContext http, SqlDatabase db,
            Notifier notifier, CancellationToken ct) =>
            Send(id, request, p, http, db, notifier, SuperSurface, ct));
        return listings;
    }

    /// <summary>
    /// What has already been asked for. Staff read this before writing, so the same owner is not sent
    /// the same request three times by three people.
    /// </summary>
    private static async Task<IResult> List(
        long id, ClaimsPrincipal principal, SqlDatabase db, Surface surface, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }
        if (surface.Authorize(admin, surface.Permission) is { } refused)
        {
            return refused;
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        var alerts = await ListingAlerts.ListForListingAsync(conn, null, id, ct);
        return Results.Ok(new AlertsDto(alerts, ListingAlerts.Reasons));
    }

    private static async Task<IResult> Send(
        long id,
        SendAlertRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        SqlDatabase db,
        Notifier notifier,
        Surface surface,
        CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }
        if (surface.Authorize(admin, surface.Permission) is { } refused)
        {
            return refused;
        }

        if (ListingAlerts.Validate(request.Reason, request.Message) is { } errors)
        {
            return Results.ValidationProblem(errors);
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        /* The listing's name and URL, read in the transaction that writes the alert, because both go
           into the email. A listing with no primary category has no public URL yet; that is not a
           reason to refuse the alert — it is very often the thing being complained about. */
        string name;
        string? listingUrl;
        await using (var lookup = new SqlCommand(
            @"SELECT li.name, li.slug, pc.slug, pcparent.slug
              FROM dbo.listings li
              LEFT JOIN dbo.listing_categories lc ON lc.listing_id = li.id AND lc.is_primary = 1
              LEFT JOIN dbo.categories pc ON pc.id = lc.category_id
              LEFT JOIN dbo.categories pcparent ON pcparent.id = pc.parent_id
              WHERE li.id = @id", conn, tx))
        {
            lookup.Parameters.AddWithValue("id", id);
            await using var reader = await lookup.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                return Results.NotFound();
            }

            name = reader.GetString(0);
            listingUrl = PublicUrl.ForListing(
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetString(1));
        }

        var (alert, notificationId, email) = await ListingAlerts.SendAsync(
            conn, tx, admin, id, name, listingUrl,
            request.Reason!, request.Message!, surface.AuditAction, http, notifier.SiteBaseUrl, ct);

        await tx.CommitAsync(ct);

        // After the commit, and never allowed to fail the send: the alert is already stored and the
        // owner can see it in their dashboard, so a dead mail provider shows up as a 'failed'
        // notification row rather than as a message that was never recorded.
        if (notificationId is not null)
        {
            await notifier.DeliverAsync(conn, notificationId.Value, email!, ct);
        }

        return Results.Created($"/api/v1/admin/listings/{id}/alerts", alert);
    }
}
