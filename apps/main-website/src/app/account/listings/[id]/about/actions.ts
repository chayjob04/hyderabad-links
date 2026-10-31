"use server";

import { revalidatePath } from "next/cache";
import {
  addListingAttribute,
  addListingContent,
  addListingFaq,
  deleteListingAttribute,
  deleteListingContent,
  deleteListingFaq,
} from "@/lib/owner-api";

export type AboutState = { error?: string; added?: string };

/**
 * Adds a FAQ.
 *
 * The allowance is not checked here. The API counts inside the same transaction that inserts the
 * row, with the listing locked first, so two tabs open at once cannot both use the last slot — a
 * check in this action would be a guess that the server then has to make properly anyway.
 */
export async function addFaqAction(
  listingId: number,
  _previous: AboutState,
  formData: FormData,
): Promise<AboutState> {
  const result = await addListingFaq(
    listingId,
    String(formData.get("question") ?? ""),
    String(formData.get("answer") ?? ""),
  );

  if (!result.ok) {
    return { error: Object.values(result.fieldErrors)[0] ?? result.message };
  }

  revalidatePath(`/account/listings/${listingId}/about`);
  return { added: "question" };
}

export async function removeFaqAction(listingId: number, faqId: number): Promise<void> {
  await deleteListingFaq(listingId, faqId);
  revalidatePath(`/account/listings/${listingId}/about`);
}

export async function addContentAction(
  listingId: number,
  _previous: AboutState,
  formData: FormData,
): Promise<AboutState> {
  const result = await addListingContent(
    listingId,
    String(formData.get("heading") ?? ""),
    String(formData.get("body") ?? ""),
  );

  if (!result.ok) {
    return { error: Object.values(result.fieldErrors)[0] ?? result.message };
  }

  revalidatePath(`/account/listings/${listingId}/about`);
  return { added: "section" };
}

export async function removeContentAction(listingId: number, sectionId: number): Promise<void> {
  await deleteListingContent(listingId, sectionId);
  revalidatePath(`/account/listings/${listingId}/about`);
}

/**
 * Adds one label to a list.
 *
 * The limit and the duplicate check are not repeated here. The API counts inside the transaction
 * that inserts, with the listing locked, so a check in this action would be a guess the server has
 * to make properly anyway — and a guess that two open tabs would get wrong.
 */
export async function addAttributeAction(
  listingId: number,
  kind: string,
  _previous: AboutState,
  formData: FormData,
): Promise<AboutState> {
  const result = await addListingAttribute(listingId, kind, String(formData.get("label") ?? ""));

  if (!result.ok) {
    return { error: Object.values(result.fieldErrors)[0] ?? result.message };
  }

  revalidatePath(`/account/listings/${listingId}/about`);
  return { added: kind };
}

export async function removeAttributeAction(listingId: number, attributeId: number): Promise<void> {
  await deleteListingAttribute(listingId, attributeId);
  revalidatePath(`/account/listings/${listingId}/about`);
}
