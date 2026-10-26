// Server-side only. After a listing is added, corrected or removed here, ask the public site to
// refresh the pages that show it, so the change appears at once instead of after the public site's
// 60-second cache window.
//
// Both settings are read at runtime, and with either missing the call is skipped silently: the
// public site still picks the change up within a minute on its own. So this is optional
// configuration that makes things immediate — never the thing that makes them work.
const MAIN_SITE_URL = process.env.MAIN_SITE_URL;
const REVALIDATE_TOKEN = process.env.REVALIDATE_TOKEN;

/** Never throws: a failed refresh is not a reason to tell someone their change did not save. */
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

/** The public pages a change to this listing affects. */
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
