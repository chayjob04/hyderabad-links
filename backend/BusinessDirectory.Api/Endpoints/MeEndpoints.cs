using BusinessDirectory.Api.Data;
using System.Security.Claims;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>Endpoints for the signed-in business owner, under /api/v1/me. Every route requires an owner access token.</summary>
public static class MeEndpoints
{
    /// <param name="NeedsOnboarding">
    /// True until the owner has registered (decision D24). Verifying the OTP creates the user row,
    /// so a signed-in owner with no name is one who has not finished registering yet. The rule lives
    /// here rather than in each website.
    /// </param>
    public sealed record MeDto(long Id, string Phone, string? Name, string? Email, bool NeedsOnboarding);

    public static RouteGroupBuilder MapMeEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/me").RequireAuthorization("Owner");
        group.MapGet("", GetMe);
        group.MapOwnerOnboardingEndpoints();
        group.MapOwnerOverviewEndpoints();
        group.MapOwnerEnquiryEndpoints();
        group.MapCustomerReviewEndpoints();
        group.MapOwnerProfileEndpoints();
        group.MapFavouriteEndpoints();   // listings this person saved; private to them
        group.MapOwnerListingEndpoints();
        group.MapOwnerSubscriptionOverview();   // every listing's plan in one request
        return group;
    }

    /// <summary>Reads the owner's user id from the validated token.</summary>
    public static bool TryGetUserId(ClaimsPrincipal user, out long userId)
    {
        var sub = user.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        return long.TryParse(sub, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out userId);
    }

    private static async Task<IResult> GetMe(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var command = db.CreateCommand("SELECT phone_e164, name, email FROM users WHERE id = @id AND status = 'active'");
        command.Parameters.AddWithValue("id", userId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return Results.Unauthorized();
        }

        var name = reader.IsDBNull(1) ? null : reader.GetString(1);
        return Results.Ok(new MeDto(
            userId,
            reader.GetString(0),
            name,
            reader.IsDBNull(2) ? null : reader.GetString(2),
            NeedsOnboarding: name is null));
    }
}
