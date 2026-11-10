"use client";

import { useActionState } from "react";
import { decideReviewAction } from "./actions";
import { initialReviewDecisionState } from "./decision-state";

const approveButton =
  "rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60";
const rejectButton =
  "rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60";

/** Approve or reject one review, with the note the reviewer will read on a rejection. */
export function ReviewDecision({ reviewId }: { reviewId: number }) {
  const [state, formAction, pending] = useActionState(
    decideReviewAction.bind(null, reviewId),
    initialReviewDecisionState,
  );

  return (
    <form action={formAction} className="mt-4 border-t border-neutral-200 pt-4">
      <label htmlFor={`note-${reviewId}`} className="block text-sm font-medium">
        Reason (needed to reject)
      </label>
      <textarea
        id={`note-${reviewId}`}
        name="note"
        rows={2}
        defaultValue={state.note}
        placeholder="Why can this review not be published? The reviewer sees this."
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      />

      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" name="intent" value="approve" disabled={pending} formNoValidate className={approveButton}>
          {pending ? "Saving..." : "Approve and publish"}
        </button>
        <button type="submit" name="intent" value="reject" disabled={pending} formNoValidate className={rejectButton}>
          Reject
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
