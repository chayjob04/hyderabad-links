// Server-side only. After a listing is approved, ask the public site to refresh the pages that now
// show it, so it appears at once instead of after the public site's 60-second cache window.
//
// Both settings are read at runtime. When either is missing the call is skipped silently: the public
// site still picks the listing up on its own within a minute, so a misconfigured deployment is slower,
// never broken.
const MAIN_SITE_URL = process.env.MAIN_SITE_URL;
const REVALIDATE_TOKEN = process.env.REVALIDATE_TOKEN;

/** Never throws: a failed refresh is not a reason to tell the admin their decision did not work. */
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

/** The public pages a decision about this listing changes. */
export function pagesAffectedBy(listing: {
  url: string | null;
  citySlug: string;
  localitySlug: string;
  categorySlug: string | null;
}): string[] {
  const paths = ["/search"];
  if (listing.url) paths.push(listing.url);
  if (listing.categorySlug) paths.push(`/${listing.citySlug}/${listing.localitySlug}/${listing.categorySlug}`);
  return paths;
}
