"use client";

import { useActionState } from "react";
import { decideChangesAction } from "./actions";
import { initialChangeDecisionState } from "./decision-state";

/**
 * Approve or reject one owner's edit, with the note they will read on a refusal.
 *
 * The same shape as the review queue's decision form, deliberately: it is the same judgement with
 * the same two outcomes, and a moderator moving between the two screens should not have to learn a
 * second arrangement. `formNoValidate` on both buttons because a refusal needs the note and an
 * approval does not, and the server is what decides which.
 */
export function ChangeDecision({
  listingId,
  listingUrl,
}: {
  listingId: number;
  listingUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    decideChangesAction.bind(null, listingId, listingUrl),
    initialChangeDecisionState,
  );

  return (
    <form action={formAction} className="border-top mt-4 pt-3">
      <label htmlFor={`note-${listingId}`} className="form-label">
        Reason (needed to reject)
      </label>
      <textarea
        id={`note-${listingId}`}
        name="note"
        rows={3}
        defaultValue={state.note}
        maxLength={1000}
        placeholder="What does the owner need to change? They read this."
        className="form-control"
      />

      <div className="d-flex flex-wrap justify-content-end gap-2 mt-3">
        <button
          type="submit"
          name="intent"
          value="reject"
          disabled={pending}
          formNoValidate
          className="btn btn-outline-danger"
        >
          Reject
        </button>
        <button
          type="submit"
          name="intent"
          value="approve"
          disabled={pending}
          formNoValidate
          className="btn btn-primary"
        >
          {pending ? "Saving..." : "Approve and publish"}
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
