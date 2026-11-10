"use client";

import { useActionState } from "react";
import { liveStatusAction } from "../actions";
import { initialDecisionState } from "../decision-state";

const suspendButton =
  "rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60";
const reinstateButton =
  "rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60";

/**
 * Takes a published listing off the site, or puts a suspended one back.
 *
 * Suspending needs a reason because the owner reads it on their own screens, in the same place a
 * rejection reason appears. Putting one back needs none: nothing is left to explain.
 */
export function LiveStatusForm({ listingId, suspended }: { listingId: number; suspended: boolean }) {
  const [state, formAction, pending] = useActionState(liveStatusAction.bind(null, listingId), initialDecisionState);

  return (
    <form action={formAction} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold">{suspended ? "This listing is suspended" : "Take it off the site"}</h2>
      <p className="mt-1 text-sm text-neutral-600">
        {suspended
          ? "It is hidden from the public site. Putting it back makes it visible again straight away."
          : "The listing stops appearing in search and its page stops resolving. Nothing is deleted, and you can put it back at any time."}
      </p>

      {suspended ? null : (
        <>
          <label htmlFor="suspend-reason" className="mt-3 block text-sm font-medium">
            Reason
          </label>
          <textarea
            id="suspend-reason"
            name="reason"
            rows={3}
            defaultValue={state.reason}
            placeholder="Why is this listing being taken down? The owner will see this."
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
          />
        </>
      )}

      <div className="mt-4">
        {suspended ? (
          <button type="submit" name="intent" value="reinstate" disabled={pending} className={reinstateButton}>
            {pending ? "Saving..." : "Put it back on the site"}
          </button>
        ) : (
          <button type="submit" name="intent" value="suspend" disabled={pending} formNoValidate className={suspendButton}>
            {pending ? "Saving..." : "Suspend this listing"}
          </button>
        )}
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
