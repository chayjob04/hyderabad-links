"use server";

import { redirect } from "next/navigation";
import { createListing, logoutSession, updateListing, type ListingFormInput } from "@/lib/owner-api";
import { clearSessionCookies, readTokens } from "@/lib/session";
import type { ListingFormState } from "./form-state";

const FIELDS = ["name", "categorySlug", "localitySlug", "addressLine", "pincode", "phonePrimary", "phoneWhatsapp", "websiteUrl", "description"] as const;

function readInput(formData: FormData): { input: ListingFormInput; values: Record<string, string> } {
  const values: Record<string, string> = {};
  for (const field of FIELDS) values[field] = String(formData.get(field) ?? "");

  /* Which of the two buttons was pressed, carried in the submitting button's own value -- plain
     HTML, so there is no second action to keep in step with the first. Anything that is not
     "submit" is a save, which is the answer that cannot surprise anybody. */
  const submitForReview = formData.get("intent") === "submit";

  return { input: { ...(values as unknown as ListingFormInput), submitForReview }, values };
}

/** Creates (listingId null) or updates a listing. Bind the id from the page: saveListingAction.bind(null, id). */
export async function saveListingAction(listingId: number | null, previous: ListingFormState, formData: FormData): Promise<ListingFormState> {
  const { input, values } = readInput(formData);
  const rev = previous.rev + 1;

  const result = listingId === null ? await createListing(input) : await updateListing(listingId, input);
  if (!result.ok) return { rev, values, message: result.message, fieldErrors: result.fieldErrors };

  /* What happened, in the owner's words. Submit and Save are different acts and have to read
     differently, and the status the API returned is the authority on which one took place -- an
     edit to a listing that is already public goes back through review even on a save. */
  const submitted = input.submitForReview === true;
  const message = submitted
    ? "Sent for review. We will show it on the site once it is approved."
    : result.data.status === "pending_review"
      ? "Changes saved and sent for review, because this listing is already on the site."
      : "Changes saved. It is still a draft until you press Submit.";

  /* A new business does not go back into the blank form it was just filled in from.
     Saved: straight on to the editor for the listing that now exists, where the four sections that
     need a listing to attach to are live and the same two buttons are at the foot of the page.
     `created=1` is what makes it say so. This replaced a "Saved -- what to do next" page listing
     links to the five screens that are sections of the editor now; it was a stop between the owner
     and the work, and the work is one click further on either way.
     Submitted: the listings page, which already has the "we will show it once approved" banner. */
  if (listingId === null) {
    redirect(
      submitted
        ? "/account/listings?submitted=1"
        : `/account/listings/${result.data.id}/edit?created=1`,
    );
  }
  return { rev, values, success: true, message, fieldErrors: {} };
}


export async function signOutAction(): Promise<void> {
  const { refresh } = await readTokens();
  if (refresh) await logoutSession(refresh);
  await clearSessionCookies();
  redirect("/");
}
