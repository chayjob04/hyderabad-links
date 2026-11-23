using System.Data;
using System.Security.Claims;
using BusinessDirectory.Api.Data;
using BusinessDirectory.Api.Listings;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// "My area is not listed" — /api/v1/me/taxonomy-suggestions (S0032).
///
/// The sign-up form offers this when none of the hundreds of areas or categories is the right one.
/// It used to go nowhere: the name was shown back with a prefilled email to support, and an owner
/// who did not send that email had asked nobody. Now it is a row in a queue staff can work.
///
/// <b>Nothing public is created here.</b> An area decides a listing's web address and a category
/// decides where it is filed, so both are created by a person, through the admin screens, with the
/// facts only a person has — where the area is on the map, which category the new one belongs
/// under. This endpoint records a request and answers the one question the owner actually has: do
/// they have to wait, or is the thing they want already there under another name?
/// </summary>
public static class OwnerSuggestionEndpoints
{
    /// <param name="Kind">`locality` for an area, `category` for a kind of business.</param>
    /// <param name="ListingId">
    /// The listing it is for, when there is one. A sign-up request has none: the account has no
    /// listing until it finishes, which is the moment this is usually sent.
    /// </param>
    public sealed record SuggestionRequest(string? Kind, string? Name, long? ListingId);

    /// <param name="Status">
    /// `pending` when it is now in the queue, or `already_exists` when the directory already has it
    /// — in which case `existingName` is what to choose instead and nothing was stored.
    /// </param>
    public sealed record SuggestionResultDto(
        long? Id,
        string Kind,
        string SuggestedName,
        string Status,
        string? ExistingName,
        /// <summary>True when this request was already in the queue. Not an error: the same answer.</summary>
        bool AlreadyRequested);

    public static RouteGroupBuilder MapOwnerSuggestionEndpoints(this RouteGroupBuilder me)
    {
        me.MapPost("/taxonomy-suggestions", Create);
        return me;
    }

    private static async Task<IResult> Create(
        SuggestionRequest request,
        ClaimsPrincipal principal,
        SqlDatabase db,
        CancellationToken ct)
    {
        if (!MeEndpoints.TryGetUserId(principal, out var userId))
        {
            return Results.Unauthorized();
        }

        var kind = (request.Kind ?? string.Empty).Trim().ToLowerInvariant();
        if (!TaxonomySuggestion.Kinds.Contains(kind))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["kind"] = ["Ask for an area or a category."],
            });
        }

        if (!TaxonomySuggestion.TryReadName(request.Name, out var name, out var nameError))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [nameError] });
        }

        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginSqlTransactionAsync(ct);

        /* Already in the directory? Then the owner is not waiting for anything -- they are looking
           for something that is in the list under a name they did not expect. Telling them now
           beats a day's wait for staff to say the same thing, and nothing is stored: a queue item
           whose answer is already known is just work for somebody. */
        var existing = await TaxonomySuggestion.ExistingNameAsync(conn, tx, kind, name, ct);
        if (existing is not null)
        {
            return Results.Ok(new SuggestionResultDto(
                null, kind, name, TaxonomySuggestion.AlreadyExists, existing, AlreadyRequested: false));
        }

        /* The listing, if one was named, has to be the caller's. An owner may say "this is for my
           cafe"; nobody may attach a request to somebody else's listing and have staff read it
           while looking at that listing. */
        long? listingId = null;
        if (request.ListingId is { } candidate)
        {
            await using var owned = new SqlCommand(
                @"SELECT TOP (1) li.id
                  FROM dbo.listings li
                  JOIN dbo.business_members bm ON bm.business_id = li.business_id AND bm.user_id = @user
                  WHERE li.id = @listing", conn, tx);
            owned.Parameters.AddWithValue("user", userId);
            owned.Parameters.AddWithValue("listing", candidate);
            if (await owned.ExecuteScalarAsync(ct) is not long found)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["listingId"] = ["That listing is not yours."],
                });
            }
            listingId = found;
        }

        var normalised = TaxonomySuggestion.Normalise(name);

        /* Somebody has already asked for this and nobody has answered yet. That is the same request,
           not a second one, so the answer is the same answer -- and the filtered unique index would
           refuse the insert anyway. Returning the existing row keeps a double submit from looking
           like a failure to the owner. */
        await using (var waiting = new SqlCommand(
            @"SELECT TOP (1) id FROM dbo.taxonomy_suggestions
              WHERE kind = @kind AND normalised = @normalised AND status = 'pending'", conn, tx))
        {
            waiting.Parameters.Add(new SqlParameter("kind", SqlDbType.VarChar) { Value = kind });
            waiting.Parameters.AddWithValue("normalised", normalised);
            if (await waiting.ExecuteScalarAsync(ct) is long already)
            {
                return Results.Ok(new SuggestionResultDto(
                    already, kind, name, TaxonomySuggestion.Pending, null, AlreadyRequested: true));
            }
        }

        long id;
        await using (var insert = new SqlCommand(
            @"INSERT INTO dbo.taxonomy_suggestions
                  (kind, suggested_name, normalised, status, user_id, listing_id)
              OUTPUT INSERTED.id
              VALUES (@kind, @name, @normalised, 'pending', @user, @listing)", conn, tx))
        {
            insert.Parameters.Add(new SqlParameter("kind", SqlDbType.VarChar) { Value = kind });
            insert.Parameters.Add(new SqlParameter("name", SqlDbType.NVarChar) { Value = name });
            insert.Parameters.Add(new SqlParameter("normalised", SqlDbType.NVarChar) { Value = normalised });
            insert.Parameters.AddWithValue("user", userId);
            insert.Parameters.Add(new SqlParameter("listing", SqlDbType.BigInt)
            {
                Value = (object?)listingId ?? DBNull.Value,
            });
            id = (long)(await insert.ExecuteScalarAsync(ct))!;
        }

        await tx.CommitAsync(ct);

        return Results.Ok(new SuggestionResultDto(
            id, kind, name, TaxonomySuggestion.Pending, null, AlreadyRequested: false));
    }
}
