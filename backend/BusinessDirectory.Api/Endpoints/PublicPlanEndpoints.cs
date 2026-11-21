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
        /// <summary>
        /// The link allowance, and <c>null</c> since S0029 because there is no longer one: links are
        /// unlimited on every plan. Null rather than a number is deliberate -- it is the same
        /// convention <c>dbo.listing_entitlements.link_limit</c> uses, so the two cannot drift into
        /// disagreeing about what "no limit" looks like.
        ///
        /// It used to be computed here as <c>badge ? 5 : 0</c>, which went on advertising the old
        /// five-link cap after the cap itself was dropped. Kept as a field, rather than removed,
        /// because removing it is a breaking change to a public response and nothing needs it gone;
        /// what matters is that it stops claiming a limit that is not enforced. Read
        /// <paramref name="CanNameLinks"/> for what the paid plan actually buys.
        /// </summary>
        int? LinkLimit,
        /// <summary>
        /// Whether this plan may name its own links. Links themselves are unlimited on every plan
        /// since S0029, so there is no allowance left to quote -- only who may label them.
        /// </summary>
        bool CanNameLinks,
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

           Links are unlimited on every plan (S0029), so what distinguishes the tiers is whether
           an owner may name them. Derived from the badge, the same way listing_entitlements derives
           it, rather than invented here.

           link_limit is NULL for the same reason it is NULL in that view: there is no allowance to
           quote. It is selected as a typed NULL rather than left out so the column list, the reader
           indices below and the DTO stay in step. */
        await using var command = db.CreateCommand(
            @"SELECT slug, name, price_paise, photo_limit, video_limit, logo_limit,
                     CAST(NULL AS int) AS link_limit,
                     grants_verified_badge AS can_name_links,
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
                // link_limit: always NULL now. Read as nullable so this does not throw the day it is.
                reader.IsDBNull(6) ? null : reader.GetInt32(6),
                // can_name_links: the badge column itself, read as the bit it is.
                reader.GetBoolean(7),
                reader.GetInt32(8),
                reader.GetInt32(9),
                reader.GetBoolean(10)));
        }

        return Results.Ok(plans);
    }
}
