"use client";

import { useActionState } from "react";
import { decideReviewAction } from "./actions";
import { initialReviewDecisionState } from "./decision-state";

/**
 * Approve or reject one review, with the note the reviewer will read on a rejection.
 *
 * On the theme's form classes now. The two buttons keep `formNoValidate`, because a rejection
 * needs the note and an approval does not, and the server is what decides which.
 */
export function ReviewDecision({ reviewId }: { reviewId: number }) {
  const [state, formAction, pending] = useActionState(
    decideReviewAction.bind(null, reviewId),
    initialReviewDecisionState,
  );

  return (
    <form action={formAction} className="border-top mt-3 pt-3">
      <label htmlFor={`note-${reviewId}`} className="form-label">
        Reason (needed to reject)
      </label>
      <textarea
        id={`note-${reviewId}`}
        name="note"
        rows={2}
        defaultValue={state.note}
        placeholder="Why can this review not be published? The reviewer sees this."
        className="form-control"
      />

      <div className="d-flex flex-wrap gap-2 mt-3">
        <button type="submit" name="intent" value="approve" disabled={pending} formNoValidate className="btn btn-primary">
          {pending ? "Saving..." : "Approve and publish"}
        </button>
        <button type="submit" name="intent" value="reject" disabled={pending} formNoValidate className="btn btn-outline-danger">
          Reject
        </button>
      </div>

      {state.error ? (
        <div role="alert" className="alert alert-danger py-2 px-3 mt-3 mb-0 font-size-13">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}
