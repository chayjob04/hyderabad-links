using BusinessDirectory.Api.Data;
using Microsoft.Data.SqlClient;

namespace BusinessDirectory.Api.Endpoints;

/// <summary>
/// The staff-written page titles and descriptions, for the website to read.
///
/// `page_meta` and its admin screen already existed; until this endpoint there was nothing on the
/// public side that could see them, so an override saved in the admin panel changed nothing. This
/// is the read half.
///
/// <b>An override, never a requirement.</b> A page with no row keeps the metadata it works out for
/// itself, so 404 here is the normal answer and the website treats it as "use your own".
///
/// One call returns everything, because the website needs the whole map rather than one page at a
/// time: Next.js builds metadata per page, and a fetch per page would be one request per render.
/// The table holds at most a few hundred rows and the response is cached, so sending it whole is
/// cheaper than the alternative in every way that matters here.
/// </summary>
public static class PublicPageMetaEndpoints
{
    /// <param name="Key">The page slug, or the page key for a static page.</param>
    public sealed record PublicMetaDto(
        string EntityType,
        string Key,
        string? MetaTitle,
        string? MetaDescription,
        string? OgImageUrl,
        bool Noindex);

    public static RouteGroupBuilder MapPublicPageMetaEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/page-meta", GetAll);
        return group;
    }

    private static async Task<IResult> GetAll(SqlDatabase db, CancellationToken ct)
    {
        /* Keyed by SLUG, not by id. The admin panel addresses a row by the entity's id because that
           is what it has; the website only ever knows a page by its slug, and sending ids would
           mean either exposing them in the public API or making every page fetch its own id first.
           The join does the translation once, here.

           meta_keywords is deliberately not returned. Google has ignored the keywords meta tag for
           years; it is kept in the table because staff still like filling it in, and leaving it out
           here stops the website rendering a tag that does nothing. */
        await using var command = db.CreateCommand(
            @"SELECT m.entity_type,
                     COALESCE(m.page_key, li.slug, c.slug, lo.slug) AS page_key,
                     m.meta_title, m.meta_description, m.og_image_url, m.noindex
              FROM dbo.page_meta m
              LEFT JOIN dbo.listings li ON m.entity_type = 'listing' AND li.id = m.entity_id
              LEFT JOIN dbo.categories c ON m.entity_type = 'category' AND c.id = m.entity_id
              LEFT JOIN dbo.localities lo ON m.entity_type = 'locality' AND lo.id = m.entity_id
              -- An override whose entity has since been deleted has nothing to key on, so it is
              -- left out rather than returned with a null the website would have to guard against.
              WHERE COALESCE(m.page_key, li.slug, c.slug, lo.slug) IS NOT NULL
              ORDER BY m.entity_type, page_key");

        var items = new List<PublicMetaDto>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new PublicMetaDto(
                reader.GetString(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetBoolean(5)));
        }

        return Results.Ok(items);
    }
}
