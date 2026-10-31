/**
 * Pictures for category and subcategory pages.
 *
 * ## Why this file is a map and not a convention
 *
 * The original Hyderabad Links stored a filename per category in `PrimaryCategory.PrimaryCategoryIcon`
 * / `.PrimaryCategoryBanner` and `SubCategory.SubCategoryIcon` / `.SubCategoryBanner`. Those files
 * are in the original project under `wwwroot/DataMedia/PC` and `/SC`, but they are named by the
 * original's numeric ids — `pc1-06-05-140.jpg`, `sc14bg-07-05-439.jpg` — and nothing in the files
 * themselves says which category each belongs to. The mapping lives only in those database columns.
 *
 * So this is a lookup keyed by **this** project's slugs, filled in from that query. It is empty
 * until somebody runs it (the query is in docs/stack-and-apis.md), and an empty map is a working
 * state: every page falls back to the drawn icon it already uses, which is why nothing here is
 * required for the site to look finished.
 *
 * ## What must never happen
 *
 * A category must not be given a picture of something else. A photograph of a café on the
 * "Plumbers" page is worse than no photograph: it is a claim about businesses that are not there.
 * That is the whole reason this is a hand-checked map rather than anything automatic.
 */

/** Where category images live once copied in, relative to `public/`. */
export const CATEGORY_IMAGE_BASE = "/category-images";

/**
 * Slug to filename, for top-level categories and subcategories alike — slugs are unique across
 * both in this schema, so one map covers them.
 *
 * Add an entry only when you know the image genuinely depicts that category.
 */
export const CATEGORY_IMAGES: Record<string, string> = {
  // Filled from the original's PrimaryCategory / SubCategory image columns.
  // Example once you have the mapping:
  //   "cafes": "sc14-07-05-920.jpg",
};

/**
 * The image for a category, or null when there is none.
 *
 * Null is the normal answer today and the caller draws its icon instead, so adding pictures later
 * changes the pages without any of them needing to be edited.
 */
export function categoryImage(slug: string): string | null {
  const file = CATEGORY_IMAGES[slug];
  return file ? `${CATEGORY_IMAGE_BASE}/${file}` : null;
}
