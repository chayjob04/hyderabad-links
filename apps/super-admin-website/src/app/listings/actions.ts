"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  archiveListing,
  createListing,
  deleteListing,
  featureListing,
  sendListingAlert,
  unfeatureListing,
  updateListing,
  type ListingFormInput,
} from "@/lib/super-admin-api";
import { pagesAffectedBy, revalidatePublicPages } from "@/lib/revalidate";
import type { AlertState, ListingFormState } from "./form-state";

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

/**
 * Asks the owner to correct something, leaving the listing where it is.
 *
 * A super admin can also just edit the listing themselves, and often should. This exists for the
 * cases where they should not: a phone number or an address can only really be confirmed by the
 * business, and quietly rewriting one on their behalf is how a directory ends up confidently wrong.
 */
export async function sendAlertAction(
  listingId: number,
  _previous: AlertState,
  formData: FormData,
): Promise<AlertState> {
  const reason = String(formData.get("reason") ?? "");
  const message = String(formData.get("message") ?? "");

  const result = await sendListingAlert(listingId, reason, message);
  if (!result.ok) {
    return { error: Object.values(result.fieldErrors)[0] ?? result.message, reason, message };
  }

  revalidatePath("/listings/" + listingId);
  return { sent: true };
}

/**
 * Puts a listing on the homepage Featured shelf, or takes it off.
 *
 * The public homepage is revalidated either way, because that is the page the change is for: the
 * shelf would otherwise be correct in this panel and stale for every visitor until the cache
 * window ran out.
 */
export async function setFeaturedAction(listingId: number, formData: FormData): Promise<void> {
  const featuring = formData.get("intent") === "feature";
  const result = featuring ? await featureListing(listingId) : await unfeatureListing(listingId);

  if (!result.ok) {
    // A full shelf and a listing that is not live are both refused with a reason worth reading.
    redirect(`/listings/${listingId}?error=${encodeURIComponent(result.message)}`);
  }

  await revalidatePublicPages(["/"]);
  revalidatePath("/listings/" + listingId);
  revalidatePath("/featured");
  redirect(
    `/listings/${listingId}?done=${encodeURIComponent(
      featuring ? "On the homepage Featured shelf." : "Off the Featured shelf.",
    )}`,
  );
}
