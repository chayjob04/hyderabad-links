// Server-side only. After a staff change, ask the public site to refresh the pages that now show
// something different, so it appears at once instead of after the public site's 60-second cache
// window (an hour, for the blog).
//
// Both settings are read at runtime. When either is missing the call is skipped silently: the public
// site still picks the change up on its own, so a misconfigured deployment is slower, never broken.
const MAIN_SITE_URL = process.env.MAIN_SITE_URL;
const REVALIDATE_TOKEN = process.env.REVALIDATE_TOKEN;

/**
 * The public site's own route shapes, copied here from `apps/main-website/src/app` because every
 * path below has to be one of them. A path that matches no route is not an error anywhere -- the
 * receiving endpoint accepts any well-formed path and `revalidatePath` on an unknown one simply does
 * nothing -- so a wrong path is silently useless, which is exactly how the bug this file used to
 * carry survived.
 *
 * ```
 *   /                                      home: featured, trending, popular categories, the strip
 *   /search                                search results
 *   /categories                            every category
 *   /[category]                            a top-level category
 *   /[category]/[subcategory]              a subcategory
 *   /[category]/[subcategory]/[slug]       one listing
 *   /areas                                 every area
 *   /areas/[locality]                      one area
 *   /areas/[locality]/[category]           one area, narrowed to a category
 *   /blog, /blog/[slug]                    the blog
 *   /about /help /pricing /privacy /terms  static pages
 *   /trending /verified /list-your-business
 * ```
 *
 * Note what a listing's path is *not*: there is no `/[city]/[locality]/[category]` route. This file
 * used to build one and send it on every approval, so the category page it was meant to refresh
 * never was. `scripts/check-revalidate-paths.test.mjs` now asserts every literal and template here
 * against that tree.
 */

/** The static pages a staff SEO override can target, and the route each one is. */
const STATIC_PAGE_PATHS: Record<string, string> = {
  home: "/",
  search: "/search",
  blog: "/blog",
  about: "/about",
  help: "/help",
  pricing: "/pricing",
  privacy: "/privacy",
  terms: "/terms",
};

/** Never throws: a failed refresh is not a reason to tell the admin their change did not work. */
export async function revalidatePublicPages(paths: string[]): Promise<void> {
  if (!MAIN_SITE_URL || !REVALIDATE_TOKEN || paths.length === 0) return;

  try {
    await fetch(`${MAIN_SITE_URL.replace(/\/$/, "")}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-revalidate-token": REVALIDATE_TOKEN },
      body: JSON.stringify({ paths }),
      cache: "no-store",
    });
  } catch {
    // The public site is unreachable or slow; its timed revalidation will catch up.
  }
}

/** Drops blanks and duplicates, so a caller can build a list without checking as it goes. */
function tidy(paths: (string | null | undefined)[]): string[] {
  return [...new Set(paths.filter((path): path is string => typeof path === "string" && path.startsWith("/")))];
}

/**
 * The public pages a decision about this listing changes.
 *
 * Derived from `listing.url`, which the API composes as `/[category]/[subcategory]/[slug]` and is
 * the only field here that is already a real public path. Its first two segments are the
 * subcategory page and its first segment the top-level category page, so both come out of the same
 * string rather than being assembled from fields that do not form a route.
 *
 * The area pages are included because a listing appears on them too: `/areas/[locality]` lists
 * everything in the area and `/areas/[locality]/[category]` narrows it. Home is deliberately left
 * out -- its shelves are featured and trending, which an approval does not change; featuring a
 * listing refreshes home from its own action.
 */
export function pagesAffectedBy(listing: {
  url: string | null;
  citySlug: string;
  localitySlug: string;
  categorySlug: string | null;
}): string[] {
  const segments = (listing.url ?? "").split("/").filter((segment) => segment !== "");
  const topCategory = segments.length >= 1 ? `/${segments[0]}` : null;
  const subcategory = segments.length >= 2 ? `/${segments[0]}/${segments[1]}` : null;

  return tidy([
    "/search",
    listing.url,
    subcategory,
    topCategory,
    listing.localitySlug ? `/areas/${listing.localitySlug}` : null,
    listing.localitySlug && listing.categorySlug
      ? `/areas/${listing.localitySlug}/${listing.categorySlug}`
      : null,
  ]);
}

/**
 * The pages that list categories. Used when a category is added, renamed, reordered, switched off
 * or removed: all four change the lists without necessarily changing any one category's own page.
 */
export function categoryListPages(): string[] {
  return ["/", "/search", "/categories"];
}

/* A category's *own* page is deliberately not refreshed. Building `/[category]` or
   `/[category]/[subcategory]` needs the parent's slug, which neither the update endpoint nor the
   row that renders the form has -- only the tree above it does. Threading it down for this would
   touch presentational components to save at most the 60-second cache window, which is not a trade
   worth making. The blog is treated differently below because its window is an hour. */

/** The pages that list areas. `/areas` is the index; home and search both offer areas too. */
export function localityListPages(): string[] {
  return ["/", "/search", "/areas"];
}

/** The lists, plus the area's own page where its slug is known. */
export function localityPages(slug: string | null): string[] {
  return tidy([...localityListPages(), slug === null ? null : `/areas/${slug}`]);
}

/**
 * The page a static SEO override is about.
 *
 * The eight keys come from `AdminSeoEndpoints.StaticPageKeys`, and each maps to exactly one route,
 * so a title changed here refreshes the page it was changed for rather than the homepage. An
 * unknown key yields nothing instead of a guess.
 */
export function staticPagePages(pageKey: string): string[] {
  const path = STATIC_PAGE_PATHS[pageKey];
  return path === undefined ? [] : [path];
}

/**
 * The public pages a review decision changes.
 *
 * The listing's own page shows the review list and the rating average, both computed over approved
 * reviews only, so approving or rejecting one changes it. Home is included because the trending
 * shelf counts approved reviews inside its window -- `ReadTrending` sums enquiries, favourites and
 * reviews with no weighting -- so a decision can reorder it. Search is not: its result cards carry
 * no rating.
 *
 * `listingUrl` is null when the listing has no primary category and therefore no public page, which
 * the review queue shows rather than hides. Nothing is refreshed in that case, which is correct:
 * there is no page to refresh.
 */
export function reviewPages(listingUrl: string | null): string[] {
  return listingUrl === null ? [] : tidy([listingUrl, "/"]);
}

/**
 * The blog index, plus one post's own page where its slug is known.
 *
 * Both matter and for different reasons: the index lists the posts, and the post page is what a
 * reader following a link gets. Only the index was refreshed before, so an edit to a published post
 * left the post itself stale for an hour.
 */
export function blogPages(slug: string | null): string[] {
  return tidy(["/blog", slug === null ? null : `/blog/${slug}`]);
}
