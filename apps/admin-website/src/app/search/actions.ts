"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addPlaceholder, addSynonym, deletePlaceholder, deleteSynonym } from "@/lib/admin-api";
import { revalidatePublicPages } from "@/lib/revalidate";

/**
 * Adds a synonym: what people type, mapped to what the catalogue calls it.
 *
 * The public site is not revalidated, because synonyms are read at query time rather than baked
 * into a page — a search run a second after this saves already uses the new mapping.
 */
export async function addSynonymAction(formData: FormData): Promise<void> {
  const term = String(formData.get("term") ?? "").trim();
  const mapsTo = String(formData.get("mapsTo") ?? "").trim();

  const result = await addSynonym(term, mapsTo);
  if (!result.ok) {
    redirect(`/search?error=${encodeURIComponent(Object.values(result.fieldErrors)[0] ?? result.message)}`);
  }

  revalidatePath("/search");
  redirect(`/search?done=${encodeURIComponent(`“${term}” now searches for “${mapsTo}”.`)}`);
}

export async function deleteSynonymAction(id: number): Promise<void> {
  const result = await deleteSynonym(id);
  if (!result.ok) {
    redirect(`/search?error=${encodeURIComponent(result.message)}`);
  }

  revalidatePath("/search");
  redirect(`/search?done=${encodeURIComponent("Removed.")}`);
}

/**
 * Adds a placeholder for the search box.
 *
 * The public homepage *is* revalidated here: the placeholder is rendered into the page, so without
 * this the new text would not appear until the cache expired.
 */
export async function addPlaceholderAction(formData: FormData): Promise<void> {
  const text = String(formData.get("text") ?? "").trim();
  const sortOrder = Number.parseInt(String(formData.get("sortOrder") ?? "0"), 10);

  const result = await addPlaceholder(text, Number.isSafeInteger(sortOrder) ? sortOrder : 0);
  if (!result.ok) {
    redirect(`/search?error=${encodeURIComponent(Object.values(result.fieldErrors)[0] ?? result.message)}`);
  }

  await revalidatePublicPages(["/"]);
  revalidatePath("/search");
  redirect(`/search?done=${encodeURIComponent("Added.")}`);
}

export async function deletePlaceholderAction(id: number): Promise<void> {
  const result = await deletePlaceholder(id);
  if (!result.ok) {
    redirect(`/search?error=${encodeURIComponent(result.message)}`);
  }

  await revalidatePublicPages(["/"]);
  revalidatePath("/search");
  redirect(`/search?done=${encodeURIComponent("Removed.")}`);
}
