"use server";

import { redirect } from "next/navigation";
import { createListing, logoutSession, submitListing, updateListing, type ListingFormInput } from "@/lib/owner-api";
import { clearSessionCookies, readTokens } from "@/lib/session";
import type { ListingFormState, SubmitState } from "./form-state";

const FIELDS = ["name", "categorySlug", "localitySlug", "addressLine", "pincode", "phonePrimary", "phoneWhatsapp", "websiteUrl", "description"] as const;

function readInput(formData: FormData): { input: ListingFormInput; values: Record<string, string> } {
  const values: Record<string, string> = {};
  for (const field of FIELDS) values[field] = String(formData.get(field) ?? "");
  return { input: values as unknown as ListingFormInput, values };
}

/** Creates (listingId null) or updates a listing. Bind the id from the page: saveListingAction.bind(null, id). */
export async function saveListingAction(listingId: number | null, previous: ListingFormState, formData: FormData): Promise<ListingFormState> {
  const { input, values } = readInput(formData);
  const rev = previous.rev + 1;

  const result = listingId === null ? await createListing(input) : await updateListing(listingId, input);
  if (!result.ok) return { rev, values, message: result.message, fieldErrors: result.fieldErrors };

  /* A new business goes to its own confirmation page, not back into the form it was just filled
     in from. Someone adding a listing needs to be told the draft is private and that review is a
     step they have to ask for — which a banner above the same form never managed to say. */
  if (listingId === null) redirect(`/account/listings/${result.data.id}/created`);
  return { rev, values, success: true, message: "Changes saved.", fieldErrors: {} };
}

export async function submitListingAction(listingId: number): Promise<SubmitState> {
  const result = await submitListing(listingId);
  if (!result.ok) {
    return { message: Object.values(result.fieldErrors).join(" ") || result.message, fieldErrors: result.fieldErrors };
  }
  redirect("/account/listings?submitted=1");
}

export async function signOutAction(): Promise<void> {
  const { refresh } = await readTokens();
  if (refresh) await logoutSession(refresh);
  await clearSessionCookies();
  redirect("/");
}
