"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearPageMeta, savePageMeta } from "@/lib/admin-api";
import { revalidatePublicPages, staticPagePages } from "@/lib/revalidate";

export type MetaState = { error?: string; saved?: boolean };

/**
 * The public page an override is about.
 *
 * This screen only ever *writes* static overrides -- `MetaForm` is rendered with
 * `entityType="static"` -- and each of the eight static keys is exactly one route, so the page whose
 * title changed is the page that gets refreshed. The homepage was refreshed before regardless,
 * which was wrong twice over: it missed the page actually edited, and it refreshed one that had not
 * changed.
 *
 * Existing overrides on a listing, category or locality can be *cleared* from the list below, and
 * those are addressed by numeric entity id rather than by slug. A path cannot be built from an id,
 * so those fall back to the homepage: the nav and footer are the only places such a page's title
 * surfaces sitewide, and the page itself catches up within the cache window.
 */
function affectedBy(entityType: string, key: string, publicPath?: string): string[] {
  if (entityType === "static") {
    const pages = staticPagePages(key);
    if (pages.length > 0) return pages;
  }
  // A category or area override knows its own page, because the screen that rendered the form
  // passed the slug along. Only a listing override, cleared from the list below, still has to
  // settle for the homepage.
  return publicPath ? [publicPath, "/"] : ["/"];
}

/**
 * Saves a page override.
 *
 * The public page is revalidated as well: metadata is cached with the page, so a title changed
 * here would otherwise not appear until the cache expired, and the person who changed it would
 * reasonably conclude it had not worked.
 */
export async function saveMetaAction(
  entityType: string,
  key: string,
  _previous: MetaState,
  formData: FormData,
): Promise<MetaState> {
  const result = await savePageMeta(entityType, key, {
    metaTitle: String(formData.get("metaTitle") ?? "").trim(),
    metaDescription: String(formData.get("metaDescription") ?? "").trim(),
    metaKeywords: String(formData.get("metaKeywords") ?? "").trim(),
    ogImageUrl: String(formData.get("ogImageUrl") ?? "").trim(),
    noindex: formData.get("noindex") === "on",
  });

  if (!result.ok) {
    return { error: Object.values(result.fieldErrors)[0] ?? result.message };
  }

  const publicPath = String(formData.get("publicPath") ?? "").trim();
  await revalidatePublicPages(affectedBy(entityType, key, publicPath || undefined));
  revalidatePath("/admin/seo");
  return { saved: true };
}

/** Removes the override, so the page goes back to the metadata it works out for itself. */
export async function clearMetaAction(entityType: string, key: string): Promise<void> {
  const result = await clearPageMeta(entityType, key);
  if (!result.ok) {
    redirect(`/admin/seo?error=${encodeURIComponent(result.message)}`);
  }

  await revalidatePublicPages(affectedBy(entityType, key));
  revalidatePath("/admin/seo");
  redirect(`/admin/seo?done=${encodeURIComponent("Back to the default.")}`);
}
