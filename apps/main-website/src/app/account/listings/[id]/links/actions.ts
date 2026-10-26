"use server";

import { revalidatePath } from "next/cache";
import { addListingLink, deleteListingLink } from "@/lib/owner-api";
import type { LinkFormState } from "./form-state";

/**
 * Adds one link. Bind the listing id from the page.
 *
 * Nothing is validated here beyond "a field was filled in". The API checks the link type against
 * the ones it accepts, parses the URL, and decides whether this listing's plan allows another link
 * at all — and it is the only side that can decide the last of those, because the allowance depends
 * on a subscription period it reads at that moment. Repeating any of it here would mean two rules
 * that can disagree.
 */
export async function addLinkAction(
  listingId: number,
  previous: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const rev = previous.rev + 1;

  const linkType = String(formData.get("linkType") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();

  if (label === "" || url === "") {
    return {
      rev,
      fieldErrors: {
        ...(label === "" ? { label: "Give the link a short label." } : {}),
        ...(url === "" ? { url: "Enter the web address." } : {}),
      },
    };
  }

  const result = await addListingLink(listingId, { linkType, label, url });
  if (!result.ok) {
    // 402 is the plan refusing, not a mistake the owner made, so it reads as a banner rather than a
    // field error. The API's own wording is used either way: it knows the allowance.
    return { rev, message: result.message, fieldErrors: result.fieldErrors };
  }

  revalidatePath(`/account/listings/${listingId}/links`);
  return { rev, success: true, message: "Link added." };
}

export async function deleteLinkAction(listingId: number, linkId: number): Promise<LinkFormState> {
  const result = await deleteListingLink(listingId, linkId);
  if (!result.ok) {
    return { rev: 0, message: result.message };
  }

  revalidatePath(`/account/listings/${listingId}/links`);
  return { rev: 0, success: true };
}
