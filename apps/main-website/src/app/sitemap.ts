import type { MetadataRoute } from "next";
import { getSitemap } from "@/lib/api";
import { absoluteUrl } from "@/lib/format";

/**
 * The XML sitemap, built from the database through the API.
 *
 * Only live listings are in it: the API filters on `status = 'active'`, so a draft, a listing
 * waiting for review, a rejected one and a suspended one are all absent, as they must be — a
 * sitemap entry for a page that answers 404 is worse than no entry at all.
 *
 * It is revalidated hourly rather than built at deploy time, because listings go live between
 * deploys.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The fixed pages are listed whatever the API says, so a sitemap is always served.
  /*
   * /search is deliberately absent. Its page sets robots noindex, because a filtered result page is
   * not a destination, and listing a page in the sitemap while telling crawlers not to index it is
   * a contradiction — the sitemap says "this is worth your time", the page says the opposite.
   * The category and area pages below are the real browse pages, and they are indexable.
   */
  const fixed: MetadataRoute.Sitemap = [{ url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 }];

  const data = await getSitemap();
  if (!data) {
    // The API is unreachable. A short sitemap of the pages we know exist beats a 500, which some
    // crawlers treat as the whole sitemap being broken.
    return fixed;
  }

  return [
    ...fixed,
    ...data.listings.map((entry) => ({
      url: absoluteUrl(entry.url),
      lastModified: entry.lastModified ? new Date(entry.lastModified) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...data.localities.map((entry) => ({
      url: absoluteUrl(entry.url),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...data.categories.map((entry) => ({
      url: absoluteUrl(entry.url),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
