"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  adminLogout,
  approveListing,
  reinstateListing,
  rejectListing,
  sendListingAlert,
  suspendListing,
} from "@/lib/admin-api";
import { pagesAffectedBy, revalidatePublicPages } from "@/lib/revalidate";
import { clearSessionCookies, readTokens } from "@/lib/session";
import type { AlertState } from "./alert-state";
import type { DecisionState } from "./decision-state";

/**
 * Approves or rejects one listing. The pressed button says which ("intent"), and the API decides
 * whether this admin may do it: these actions never check permissions themselves, because a server
 * action is just another caller.
 */
export async function decideAction(listingId: number, _previous: DecisionState, formData: FormData): Promise<DecisionState> {
  const intent = String(formData.get("intent") ?? "");
  const reason = String(formData.get("reason") ?? "");

  const result = intent === "approve" ? await approveListing(listingId) : await rejectListing(listingId, reason);

  if (!result.ok) {
    return { error: result.message, reason };
  }

  // The listing just appeared on (or disappeared from) the public site: refresh those pages now
  // rather than leaving a visitor to wait out the public site's cache window.
  await revalidatePublicPages(pagesAffectedBy(result.data));

  // The queue and this listing both changed.
  revalidatePath("/listings");
  redirect(`/listings?decided=${intent === "approve" ? "approved" : "rejected"}`);
}

/**
 * Takes a live listing off the site, or puts a suspended one back. Same shape as decideAction:
 * the pressed button says which, and the API decides whether this admin may do it.
 */
export async function liveStatusAction(
  listingId: number,
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const suspending = formData.get("intent") === "suspend";
  const reason = String(formData.get("reason") ?? "");

  if (suspending && reason.trim() === "") {
    return { error: "Say why it is being suspended. The owner sees this.", reason };
  }

  const result = suspending ? await suspendListing(listingId, reason) : await reinstateListing(listingId);
  if (!result.ok) {
    return { error: Object.values(result.fieldErrors)[0] ?? result.message, reason };
  }

  // It has just left or rejoined the public site, so refresh those pages now.
  await revalidatePublicPages(pagesAffectedBy(result.data));
  revalidatePath("/listings");
  revalidatePath("/listings/" + listingId);
  redirect("/listings/" + listingId + "?live=" + (suspending ? "suspended" : "reinstated"));
}

export async function signOutAction(): Promise<void> {
  const { refresh } = await readTokens();
  if (refresh) await adminLogout(refresh);
  await clearSessionCookies();
  redirect("/login");
}

/**
 * Asks the owner to correct something, leaving the listing where it is.
 *
 * This is the proportionate tool that was missing. Before it, the only thing an admin could do
 * about a wrong phone number on a live listing was suspend the business — which punishes a customer
 * looking for them far more than it does the owner who mistyped a digit.
 *
 * Like every action here, it checks nothing itself: the API decides whether this admin holds
 * listings.alert, and validates the reason and the message.
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
    // The field error first: "Say what needs changing, in at least 10 characters" is more use than
    // "One or more validation errors occurred".
    return { error: Object.values(result.fieldErrors)[0] ?? result.message, reason, message };
  }

  // The listing page lists what has already been asked for, so staff can see it without resending.
  revalidatePath("/listings/" + listingId);
  return { sent: true };
}
