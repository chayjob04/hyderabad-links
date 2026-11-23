"use server";

import { redirect } from "next/navigation";
import { approveListingChanges, rejectListingChanges } from "@/lib/admin-api";
import { revalidatePublicPages, reviewPages } from "@/lib/revalidate";
import type { ChangeDecisionState } from "./decision-state";

/**
 * Approves or rejects one owner's edit to a published listing (S0031).
 *
 * Both buttons post the same form and the intent says which, as on the listing and review queues.
 * The API checks `listings.review`, locks the staged row so two moderators cannot both decide it,
 * and refuses an edit that has not been submitted -- so nothing here is the control.
 */
export async function decideChangesAction(
  listingId: number,
  listingUrl: string | null,
  _previous: ChangeDecisionState,
  formData: FormData,
): Promise<ChangeDecisionState> {
  const note = String(formData.get("note") ?? "");
  const approving = formData.get("intent") === "approve";

  if (!approving && note.trim() === "") {
    // The owner reads this and decides what to change, so a refusal without a reason is no use.
    return { note, error: "Say what needs changing. The owner reads this." };
  }

  const result = approving
    ? await approveListingChanges(listingId)
    : await rejectListingChanges(listingId, note);

  if (!result.ok) {
    return {
      note,
      error:
        result.status === 404
          ? "Those changes are no longer waiting -- somebody else has decided them."
          : result.status === 409
            ? "The owner has not submitted these changes for review yet."
            : Object.values(result.fieldErrors)[0] ?? result.message,
    };
  }

  /* Only an approval changes the public site: a refusal leaves the published listing exactly as it
     was, which is the point of staging the edit. Refreshing on a refusal would be a request that
     could only produce the same page. */
  if (approving) {
    await revalidatePublicPages(reviewPages(listingUrl));
  }

  redirect(`/admin/listing-changes?decided=${approving ? "approved" : "rejected"}`);
}
