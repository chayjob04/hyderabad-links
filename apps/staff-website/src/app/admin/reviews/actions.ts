"use server";

import { redirect } from "next/navigation";
import { approveReview, rejectReview } from "@/lib/admin-api";
import type { ReviewDecisionState } from "./decision-state";

/**
 * Approves or rejects one review. Both buttons post the same form and the intent says which, as on
 * the listing queue. The API checks the permission and that the review is still pending, so this
 * action is never the control.
 */
export async function decideReviewAction(
  reviewId: number,
  _previous: ReviewDecisionState,
  formData: FormData,
): Promise<ReviewDecisionState> {
  const note = String(formData.get("note") ?? "");
  const approving = formData.get("intent") === "approve";

  if (!approving && note.trim() === "") {
    // The reviewer reads this, so a rejection without a reason is not much use to them.
    return { note, error: "Say why it was rejected. The reviewer sees this." };
  }

  const result = approving ? await approveReview(reviewId) : await rejectReview(reviewId, note);
  if (!result.ok) {
    return {
      note,
      error:
        result.status === 404
          ? "That review has already been decided by someone else."
          : Object.values(result.fieldErrors)[0] ?? result.message,
    };
  }

  redirect(`/admin/reviews?decided=${approving ? "approved" : "rejected"}`);
}
