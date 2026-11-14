"use client";

import { useActionState } from "react";
import { decideAction } from "../actions";
import { initialDecisionState } from "../decision-state";

/**
 * Approve or reject, with the reason the owner will read. Both buttons post the same form; the API
 * checks the permission and the listing's status again, so this form is never the control.
 *
 * On the theme's form classes. The card around it is the page's, so this is the form only.
 */
export function DecisionForm({ listingId }: { listingId: number }) {
  const [state, formAction, pending] = useActionState(decideAction.bind(null, listingId), initialDecisionState);

  return (
    <form action={formAction}>
      <label htmlFor="reason" className="form-label">
        Reason (only needed to reject)
      </label>
      <textarea
        id="reason"
        name="reason"
        rows={6}
        defaultValue={state.reason}
        placeholder="What should the owner fix? They will see this message."
        className="form-control"
      />

      <div className="d-grid gap-2 mt-3">
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
