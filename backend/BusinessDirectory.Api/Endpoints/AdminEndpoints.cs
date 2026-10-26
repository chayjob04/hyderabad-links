using BusinessDirectory.Api.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Auth;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Endpoints for a signed-in administrator, under /api/v1/admin. Every route requires an admin access
/// token (the Admin policy pins the admin authentication scheme, so an owner token is rejected before
/// any handler runs) and every handler then checks the permission its action needs.
/// </summary>
public static class AdminEndpoints
{
    public sealed record AdminMeDto(
        long Id,
        string Email,
        string DisplayName,
        IReadOnlyList<string> Roles,
        IReadOnlyList<string> Permissions);

    public static RouteGroupBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/admin").RequireAuthorization(AdminAccess.Policy);
        group.MapGet("/me", GetMe);
        group.MapAdminListingEndpoints();
        group.MapAdminTaxonomyEndpoints();   // categories, subcategories and Hyderabad's localities
        group.MapAdminReviewEndpoints();
        group.MapAdminReportEndpoints();
        return group;
    }

    /// <summary>
    /// Who the caller is and what they may do. The admin site uses this to decide which buttons to draw,
    /// but drawing a button is never the control: each endpoint checks the permission again.
    /// </summary>
    private static async Task<IResult> GetMe(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        var admin = await AdminAccess.Load(db, principal, ct);
        if (admin is null)
        {
            return Results.Unauthorized();
        }

        // Only permissions that belong to this surface are reported. A super-admin holds more, but those
        // capabilities live on /api/v1/super-admin and must not appear in the admin site.
        var permissions = admin.Permissions.Where(AdminPermissions.IsAdminSurface).OrderBy(p => p, StringComparer.Ordinal).ToArray();
        return Results.Ok(new AdminMeDto(admin.Id, admin.Email, admin.DisplayName, admin.Roles, permissions));
    }
}
