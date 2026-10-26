"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  archiveListing,
  createListing,
  deleteListing,
  updateListing,
  type ListingFormInput,
} from "@/lib/super-admin-api";
import { pagesAffectedBy, revalidatePublicPages } from "@/lib/revalidate";
import type { ListingFormState } from "./form-state";

/**
 * Server actions for the listing screens. None of them checks a permission: the API checks
 * listings.create / listings.edit / listings.delete on every call, against a super-admin token,
 * and a server action is just another caller.
 */
const FIELDS = [
  "name",
  "categorySlug",
  "localitySlug",
  "addressLine",
  "pincode",
  "phonePrimary",
  "phoneWhatsapp",
  "websiteUrl",
  "description",
] as const;

function readInput(formData: FormData): { input: ListingFormInput; values: Record<string, string> } {
  const values: Record<string, string> = {};
  for (const field of FIELDS) values[field] = String(formData.get(field) ?? "");
  return { input: values as unknown as ListingFormInput, values };
}

/**
 * Adds a listing (listingId null) or saves changes to one. Bind the id from the page:
 * saveListingAction.bind(null, id).
 */
export async function saveListingAction(
  listingId: number | null,
  previous: ListingFormState,
  formData: FormData,
): Promise<ListingFormState> {
  const { input, values } = readInput(formData);
  const rev = previous.rev + 1;

  const result = listingId === null ? await createListing(input) : await updateListing(listingId, input);
  if (!result.ok) {
    return { rev, values, message: result.message, fieldErrors: result.fieldErrors };
  }

  // A new listing from here is live at once, and an edit can change what a public page shows.
  if (result.data.status === "active") {
    await revalidatePublicPages(pagesAffectedBy(result.data));
  }
  revalidatePath("/listings");

  if (listingId === null) redirect(`/listings/${result.data.id}?added=1`);
  return { rev, values, success: true, message: "Changes saved.", fieldErrors: {} };
}

/** Takes a listing off the public site, keeping its photos, enquiries, reviews and payments. */
export async function archiveListingAction(listingId: number, formData: FormData): Promise<void> {
  const listing = readPublicPaths(formData);
  const result = await archiveListing(listingId);

  if (!result.ok) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(result.message)}`);
  }

  // It has just left the public site, so refresh the pages that were showing it.
  await revalidatePublicPages(pagesAffectedBy(listing));
  revalidatePath("/listings");
  redirect(`/listings/${listingId}?done=${encodeURIComponent("Archived. It is off the public site.")}`);
}

/**
 * Removes a listing outright. The API refuses this when a subscription or payment is attached and
 * says so; that refusal is shown on the listing's own page rather than swallowed.
 */
export async function deleteListingAction(listingId: number, formData: FormData): Promise<void> {
  const listing = readPublicPaths(formData);
  const result = await deleteListing(listingId);

  if (!result.ok) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(result.message)}`);
  }

  await revalidatePublicPages(pagesAffectedBy(listing));
  revalidatePath("/listings");
  redirect(`/listings?done=${encodeURIComponent("Deleted.")}`);
}

/**
 * The listing is gone by the time we refresh the public site, so the pages it was on travel with
 * the form rather than being read back from the API.
 */
function readPublicPaths(formData: FormData) {
  return {
    url: (formData.get("url") as string) || null,
    citySlug: String(formData.get("citySlug") ?? ""),
    localitySlug: String(formData.get("localitySlug") ?? ""),
    categorySlug: (formData.get("categorySlug") as string) || null,
  };
}
