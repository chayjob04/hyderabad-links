using BusinessDirectory.Api.Data;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// What a listing costs, for the public pricing page.
///
/// The plans table and its allowances already existed; this is the read that lets somebody see
/// them before they have an account. Until now the price was only visible from inside a listing's
/// own subscription screen, which means only to people who had already signed up — the wrong way
/// round for the one page whose job is to persuade.
///
/// The price comes from the table, as it does everywhere else in this project. Nothing here hard
/// codes 399, so changing the price stays an UPDATE rather than a deploy.
/// </summary>
public static class PublicPlanEndpoints
{
    /// <param name="PricePaise">In paise, so 399 rupees arrives as 39900 and no rounding happens in transit.</param>
    public sealed record PublicPlanDto(
        string Slug,
        string Name,
        long PricePaise,
        int PhotoLimit,
        int VideoLimit,
        int LogoLimit,
        int LinkLimit,
        int FaqLimit,
        int ContentSectionLimit,
        bool GrantsVerifiedBadge);

    public static RouteGroupBuilder MapPublicPlanEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/plans", GetPlans);
        return group;
    }

    private static async Task<IResult> GetPlans(SqlDatabase db, CancellationToken ct)
    {
        /* Active plans only. A deactivated tier is one nobody may buy any more, so showing it on a
           pricing page would be advertising something that cannot be sold.

           link_limit is not a column on `plans` -- it is derived from the badge, the same way
           listing_entitlements derives it -- so it is computed here rather than invented. */
        await using var command = db.CreateCommand(
            @"SELECT slug, name, price_paise, photo_limit, video_limit, logo_limit,
                     CASE WHEN grants_verified_badge = 1 THEN 5 ELSE 0 END AS link_limit,
                     faq_limit, content_section_limit, grants_verified_badge
              FROM dbo.plans
              WHERE is_active = 1
              ORDER BY sort_order, price_paise");

        var plans = new List<PublicPlanDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            plans.Add(new PublicPlanDto(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetInt64(2),
                reader.GetInt32(3),
                reader.GetInt32(4),
                reader.GetInt32(5),
                reader.GetInt32(6),
                reader.GetInt32(7),
                reader.GetInt32(8),
                reader.GetBoolean(9)));
        }

        return Results.Ok(plans);
    }
}
