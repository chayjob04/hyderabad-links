"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  adminLogout,
  approveListing,
  reinstateListing,
  rejectListing,
  suspendListing,
} from "@/lib/admin-api";
import { pagesAffectedBy, revalidatePublicPages } from "@/lib/revalidate";
import { clearSessionCookies, readTokens } from "@/lib/session";
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
