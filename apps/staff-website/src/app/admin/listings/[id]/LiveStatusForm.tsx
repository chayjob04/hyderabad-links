"use client";

import { useActionState } from "react";
import { liveStatusAction } from "../actions";
import { initialDecisionState } from "../decision-state";

/**
 * Takes a published listing off the site, or puts a suspended one back.
 *
 * Suspending needs a reason because the owner reads it on their own screens, in the same place a
 * rejection reason appears. Putting one back needs none: nothing is left to explain.
 *
 * On the theme's form classes. The card around it is the page's, so this is the form only.
 */
export function LiveStatusForm({ listingId, suspended }: { listingId: number; suspended: boolean }) {
  const [state, formAction, pending] = useActionState(liveStatusAction.bind(null, listingId), initialDecisionState);

  return (
    <form action={formAction}>
      <p className="text-muted font-size-13">
        {suspended
          ? "It is hidden from the public site. Putting it back makes it visible again straight away."
          : "The listing stops appearing in search and its page stops resolving. Nothing is deleted, and you can put it back at any time."}
      </p>

      {suspended ? null : (
        <div className="mb-3">
          <label htmlFor="suspend-reason" className="form-label">
            Reason
          </label>
          <textarea
            id="suspend-reason"
            name="reason"
            rows={4}
            defaultValue={state.reason}
            placeholder="Why is this listing being taken down? The owner will see this."
            className="form-control"
          />
        </div>
      )}

      <div className="d-grid">
        {suspended ? (
          <button type="submit" name="intent" value="reinstate" disabled={pending} className="btn btn-primary">
            {pending ? "Saving..." : "Put it back on the site"}
          </button>
        ) : (
          <button
            type="submit"
            name="intent"
            value="suspend"
            disabled={pending}
            formNoValidate
            className="btn btn-outline-danger"
          >
            {pending ? "Saving..." : "Suspend this listing"}
          </button>
        )}
      </div>

      {state.error ? (
        <div role="alert" className="alert alert-danger py-2 px-3 mt-3 mb-0 font-size-13">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}
