"use server";

import { redirect } from "next/navigation";
import {
  createListing,
  discardPendingChanges,
  logoutSession,
  updateListing,
  type ListingFormInput,
} from "@/lib/owner-api";
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

  /* What happened, in the owner's words, decided by what the API says it did rather than by what
     was asked for.

     A listing that is already on the site is edited aside (S0031): the save comes back with the
     listing still active and a staged edit attached, and the public page has not changed. A draft
     is written straight through. Those are four different outcomes and an owner has to be able to
     tell which one they got -- "Changes saved" over a page that did not change is how somebody
     ends up pressing Save six times. */
  const submitted = input.submitForReview === true;
  const staged = result.data.pendingChanges ?? null;
  const message = staged
    ? staged.status === "pending_review"
      ? "Sent for review. Your listing stays on the site as it is until we approve the changes."
      : "Saved. Only you can see these changes \u2014 your listing is still on the site as it was. Press Submit when you want us to review them."
    : submitted
      ? "Sent for review. We will show it on the site once it is approved."
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


/**
 * Throws away a staged edit, so the editor goes back to showing what is published.
 *
 * It takes the owner back to the same page rather than returning a message, because the whole page
 * changes: the form reloads with the live values, the percentages recount, and the banner about
 * unsent changes goes away. A message above a form that still showed the discarded text would be
 * the one outcome worth avoiding.
 */
export async function discardChangesAction(listingId: number): Promise<void> {
  const result = await discardPendingChanges(listingId);
  redirect(
    result.ok
      ? `/account/listings/${listingId}/edit?discarded=1`
      : `/account/listings/${listingId}/edit?error=${encodeURIComponent(result.message)}`,
  );
}

export async function signOutAction(): Promise<void> {
  const { refresh } = await readTokens();
  if (refresh) await logoutSession(refresh);
  await clearSessionCookies();
  redirect("/");
}
