using BusinessDirectory.Api.Data;
using System.Security.Claims;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// Numbers for the business owner's dashboard overview, under /api/v1/me/overview.
///
/// Everything here is counted from rows the owner actually has. Listing views and leads are
/// deliberately absent: there are no tables for them yet, and a dashboard that invents figures is
/// worse than one that shows fewer.
/// </summary>
public static class OwnerOverviewEndpoints
{
    /// <param name="Draft">Only the owner can see these.</param>
    /// <param name="PendingReview">Waiting for an administrator to decide.</param>
    /// <param name="Rejected">Sent back with a reason; the owner can fix and resubmit.</param>
    public sealed record ListingCountsDto(
        int Total,
        int Active,
        int PendingReview,
        int Draft,
        int Rejected,
        int Suspended);

    /// <param name="Steps">Each thing the owner could still do, and whether it is done.</param>
    public sealed record ProfileCompletionDto(int Completed, int Total, IReadOnlyList<CompletionStepDto> Steps);

    public sealed record CompletionStepDto(string Key, string Label, bool Done);

    /// <param name="NewEnquiries">Unread customer enquiries across every listing this owner holds.</param>
    public sealed record OwnerOverviewDto(ListingCountsDto Listings, ProfileCompletionDto Profile, int NewEnquiries);

    public static RouteGroupBuilder MapOwnerOverviewEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/overview", GetOverview);
        return group;
    }

    // One round trip. `owned` is every listing this user owns through business_members, so the
    // counts can never include anyone else's rows.
    private const string OverviewSql =
        @"WITH owned AS (
              SELECT li.id, li.status, li.description, li.address_line
              FROM dbo.listings li
              JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
              /* Real listings only: not a staged copy of one (S0034), and not a new listing that
                 has been started and never saved. Counting either would make the dashboard
                 disagree with the list below it. */
              WHERE li.status <> 'archived'
                AND li.staged_for_listing_id IS NULL
                AND li.is_placeholder = 0
          )
          SELECT (SELECT COUNT_BIG(*) FROM owned),
                 (SELECT COUNT_BIG(*) FROM owned WHERE status = 'active'),
                 (SELECT COUNT_BIG(*) FROM owned WHERE status = 'pending_review'),
                 (SELECT COUNT_BIG(*) FROM owned WHERE status = 'draft'),
                 (SELECT COUNT_BIG(*) FROM owned WHERE status = 'rejected'),
                 (SELECT COUNT_BIG(*) FROM owned WHERE status = 'suspended'),
                 (SELECT COUNT_BIG(*) FROM owned WHERE LTRIM(RTRIM(COALESCE(description, ''))) <> ''),
                 (SELECT COUNT_BIG(*) FROM owned WHERE LTRIM(RTRIM(COALESCE(address_line, ''))) <> ''),
                 /* SQL Server has no boolean expression type, so a yes/no answer in a SELECT list
                    has to be made into a bit. PostgreSQL returned these two as booleans. */
                 CAST(CASE WHEN u.name IS NOT NULL THEN 1 ELSE 0 END AS bit),
                 CAST(CASE WHEN LTRIM(RTRIM(COALESCE(u.email, ''))) <> '' THEN 1 ELSE 0 END AS bit),
                 (SELECT COUNT_BIG(*)
                  FROM dbo.enquiries e
                  JOIN dbo.listings el ON el.id = e.listing_id
                  JOIN dbo.business_members ebm ON ebm.business_id = el.business_id AND ebm.user_id = @user
                  WHERE e.status = 'new')
          FROM dbo.users u
          WHERE u.id = @user AND u.status = 'active'";

    /// <summary>
    /// Works out what the owner could still do. Kept separate from the SQL so it can be unit-tested,
    /// and so the list of steps is obvious to read and change.
    /// </summary>
    public static ProfileCompletionDto BuildCompletion(
        bool hasName,
        bool hasEmail,
        int totalListings,
        int withDescription,
        int withAddress,
        int activeListings)
    {
        var steps = new List<CompletionStepDto>
        {
            new("name", "Add your name", hasName),
            new("email", "Add your email address", hasEmail),
            new("listing", "Create your first listing", totalListings > 0),
            new("address", "Add an address to a listing", withAddress > 0),
            new("description", "Describe what a listing offers", withDescription > 0),
            new("published", "Get a listing approved and live", activeListings > 0),
        };

        return new ProfileCompletionDto(steps.Count(step => step.Done), steps.Count, steps);
    }

    private static async Task<IResult> GetOverview(ClaimsPrincipal principal, SqlDatabase db, CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var command = db.CreateCommand(OverviewSql);
        command.Parameters.AddWithValue("user", userId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            // The token is valid but the user is gone or suspended.
            return Results.Unauthorized();
        }

        var total = (int)reader.GetInt64(0);
        var active = (int)reader.GetInt64(1);
        var counts = new ListingCountsDto(
            total,
            active,
            PendingReview: (int)reader.GetInt64(2),
            Draft: (int)reader.GetInt64(3),
            Rejected: (int)reader.GetInt64(4),
            Suspended: (int)reader.GetInt64(5));

        var completion = BuildCompletion(
            hasName: reader.GetBoolean(8),
            hasEmail: reader.GetBoolean(9),
            totalListings: total,
            withDescription: (int)reader.GetInt64(6),
            withAddress: (int)reader.GetInt64(7),
            activeListings: active);

        // Unread enquiries are a real count now that V0006 exists; before it there was no table
        // and the dashboard deliberately showed nothing rather than a fabricated zero.
        var newEnquiries = (int)reader.GetInt64(10);

        return Results.Ok(new OwnerOverviewDto(counts, completion, newEnquiries));
    }
}
