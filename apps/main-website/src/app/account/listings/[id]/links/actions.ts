"use server";

import { revalidatePath } from "next/cache";
import { addListingLink, deleteListingLink, renameListingLink } from "@/lib/owner-api";
import type { LinkFormState } from "./form-state";

/**
 * Adds one link. Bind the listing id and `canNameLinks` from the page.
 *
 * Nothing is validated here beyond "a field was filled in". The API checks the link type against
 * the ones it accepts, parses the URL, and decides who may name a link — and it is the only side
 * that can decide the last of those, because it depends on a subscription period it reads at that
 * moment. Repeating any of it here would mean two rules that can disagree.
 *
 * `canNameLinks` is passed only so this side knows whether a label is a field the owner was shown.
 * It is not a permission check: a request that claims it can name links still gets the position-
 * based name from the API unless the listing's own entitlement says otherwise.
 */
export async function addLinkAction(
  listingId: number,
  canNameLinks: boolean,
  previous: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const rev = previous.rev + 1;

  const linkType = String(formData.get("linkType") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();

  if (url === "" || (canNameLinks && label === "")) {
    return {
      rev,
      fieldErrors: {
        ...(canNameLinks && label === "" ? { label: "Give the link a short label." } : {}),
        ...(url === "" ? { url: "Enter the web address." } : {}),
      },
    };
  }

  /* No label at all on a free listing, rather than an empty one: the API names the link after its
     position, and sending "" would only invite a validation error about a box nobody saw. */
  const result = await addListingLink(listingId, {
    linkType,
    url,
    ...(canNameLinks ? { label } : {}),
  });
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

/**
 * Renames a link that already exists. Bind the listing and link ids from the page.
 *
 * The entitlement is not checked here: the API refuses with 402 unless the listing may name its own
 * links, and it is the only side that can decide that, because it reads the subscription period
 * against the clock at that moment. This side only passes the new name along and shows what came
 * back.
 */
export async function renameLinkAction(
  listingId: number,
  linkId: number,
  previous: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const rev = previous.rev + 1;
  const label = String(formData.get("label") ?? "").trim();

  if (label === "") {
    return { rev, fieldErrors: { label: "Give the link a short label." } };
  }

  const result = await renameListingLink(listingId, linkId, label);
  if (!result.ok) {
    return { rev, message: result.message, fieldErrors: result.fieldErrors };
  }

  revalidatePath(`/account/listings/${listingId}/links`);
  return { rev, success: true, message: "Name saved." };
}
