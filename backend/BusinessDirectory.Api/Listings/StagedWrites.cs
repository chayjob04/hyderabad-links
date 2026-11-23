using BusinessDirectory.Api.Data;

namespace BusinessDirectory.Api.Listings;

/// <summary>
/// Refuses a write to a section of a listing that is on the site (S0034).
///
/// A listing's photos, opening hours, questions, content, amenities and links are written by their
/// own endpoints, and each of them used to publish immediately: adding a photo to a live listing
/// changed the live page while an edit to its name and address sat in review. That is the
/// inconsistency whole-listing staging exists to remove — so these endpoints now refuse a published
/// listing, and the owner's editor works on a staged copy where every section is writable.
///
/// <para>
/// <b>Why a filter and not a line in each handler.</b> There are thirteen write handlers across the
/// five sections, and a check in each is a check the fourteenth will not have. A filter on the five
/// route groups cannot be forgotten by the next endpoint added to one — the same argument that put
/// the suspension check in <c>ActiveAccount</c> rather than in a dozen queries. It also means the
/// rule is stated once, in words, where somebody looking for it will find it.
/// </para>
/// <para>
/// <b>Reads are untouched.</b> A GET of a published listing's hours or photos is how the owner's
/// screens and the moderator's comparison read the current version. Only writes are refused.
/// </para>
/// <para>
/// <b>It costs one indexed lookup</b> by primary key on a write, which the handler behind it was
/// going to do anyway when it checked ownership.
/// </para>
/// </summary>
public static class StagedWrites
{
    /// <summary>
    /// The statement the filter runs: is this listing on the site?
    /// </summary>
    /// <remarks>
    /// Named rather than inlined so a test can assert it without a database, as
    /// <c>ActiveAccount.Realm</c> does. The id is a parameter (decision D6).
    /// </remarks>
    public const string Sql = "SELECT TOP (1) 1 FROM dbo.listings WHERE id = @id AND status = 'active'";

    /// <summary>
    /// What the owner is told. It names the way forward, because "refused" on its own would read as
    /// a fault: the editor's own screen offers exactly this.
    /// </summary>
    public const string Refusal =
        "This listing is on the site, so its sections cannot be changed directly. "
        + "Start a pending change and edit that copy; the live page keeps working until we approve it.";

    /// <summary>The route value every section group carries: /me/listings/{id}/…</summary>
    public const string RouteValue = "id";

    /// <summary>
    /// Applies the rule to one section's route group.
    /// </summary>
    /// <remarks>
    /// GET, HEAD and OPTIONS pass through. Anything else is a write, including the POSTs that move a
    /// photo or acknowledge an action, and a listing id that is not a number or not there at all is
    /// left to the handler — it knows what its own route looks like and answers 404 or 400 better
    /// than a filter could guess.
    /// </remarks>
    public static RouteGroupBuilder RefuseWritesToPublishedListings(this RouteGroupBuilder group)
    {
        group.AddEndpointFilter(FilterAsync);
        return group;
    }

    /// <summary>
    /// The same rule on one route, for the sections whose endpoints are mapped on the listings
    /// group rather than on a group of their own.
    /// </summary>
    /// <remarks>
    /// Applied at the mapping, beside the route it guards, so the set of guarded writes can be read
    /// in one place. A section that grows a group of its own should use the overload above instead:
    /// then a route added to it later is covered without anybody remembering.
    /// </remarks>
    public static RouteHandlerBuilder RefuseWritesToPublishedListings(this RouteHandlerBuilder route)
    {
        route.AddEndpointFilter(FilterAsync);
        return route;
    }

    /// <summary>
    /// Refuses anything at all on a staged copy, in both directions.
    /// </summary>
    /// <remarks>
    /// For the subscription routes. A staged copy is not a business: it is somebody's proposed next
    /// version of one, it is deleted when the edit is approved, and its entitlement is read from the
    /// listing it stands in for. So buying a plan for it would take money for a row that is about to
    /// disappear, and reading one would show a plan screen for something that cannot hold a plan.
    ///
    /// Refused rather than redirected to the parent, for the same reason the update handler refuses
    /// rather than redirecting: a payment must go where the screen says it is going.
    /// </remarks>
    public static RouteGroupBuilder RefuseStagedListings(this RouteGroupBuilder group)
    {
        group.AddEndpointFilter(async (context, next) =>
        {
            if (context.HttpContext.Request.RouteValues.TryGetValue(RouteValue, out var raw)
                && long.TryParse(
                    raw?.ToString(),
                    System.Globalization.NumberStyles.None,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var listingId))
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<SqlDatabase>();
                var ct = context.HttpContext.RequestAborted;

                await using var command = db.CreateCommand(StagedSql);
                command.Parameters.AddWithValue("id", listingId);
                if (await command.ExecuteScalarAsync(ct) is not null)
                {
                    return Results.Problem(StagedRefusal, statusCode: StatusCodes.Status409Conflict);
                }
            }

            return await next(context);
        });

        return group;
    }

    /// <summary>Is this a staged copy of another listing?</summary>
    public const string StagedSql =
        "SELECT TOP (1) 1 FROM dbo.listings WHERE id = @id AND staged_for_listing_id IS NOT NULL";

    public const string StagedRefusal =
        "These are proposed changes to a listing, not a listing of its own. "
        + "Open the listing itself for its plan and payments.";

    private static async ValueTask<object?> FilterAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        {
            var method = context.HttpContext.Request.Method;
            if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
            {
                return await next(context);
            }

            if (context.HttpContext.Request.RouteValues.TryGetValue(RouteValue, out var raw)
                && long.TryParse(
                    raw?.ToString(),
                    System.Globalization.NumberStyles.None,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var listingId))
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<SqlDatabase>();
                var ct = context.HttpContext.RequestAborted;

                await using var command = db.CreateCommand(Sql);
                command.Parameters.AddWithValue("id", listingId);
                if (await command.ExecuteScalarAsync(ct) is not null)
                {
                    /* 409, not 403: nothing is wrong with the caller or their permissions. The
                       listing is simply in a state where this write goes somewhere else, and that
                       somewhere else is one request away. */
                    return Results.Problem(Refusal, statusCode: StatusCodes.Status409Conflict);
                }
            }

            return await next(context);
        }
    }
}
