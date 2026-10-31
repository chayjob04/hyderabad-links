"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearPageMeta, savePageMeta } from "@/lib/admin-api";
import { revalidatePublicPages } from "@/lib/revalidate";

export type MetaState = { error?: string; saved?: boolean };

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

  await revalidatePublicPages(["/"]);
  revalidatePath("/seo");
  return { saved: true };
}

/** Removes the override, so the page goes back to the metadata it works out for itself. */
export async function clearMetaAction(entityType: string, key: string): Promise<void> {
  const result = await clearPageMeta(entityType, key);
  if (!result.ok) {
    redirect(`/seo?error=${encodeURIComponent(result.message)}`);
  }

  await revalidatePublicPages(["/"]);
  revalidatePath("/seo");
  redirect(`/seo?done=${encodeURIComponent("Back to the default.")}`);
}
