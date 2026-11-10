"use client";

import { useActionState } from "react";
import { decideAction } from "../actions";
import { initialDecisionState } from "../decision-state";

const approveButton =
  "rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60";
const rejectButton =
  "rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60";

/**
 * Approve or reject, with the reason the owner will read. Both buttons post the same form; the API
 * checks the permission and the listing's status again, so this form is never the control.
 */
export function DecisionForm({ listingId }: { listingId: number }) {
  const [state, formAction, pending] = useActionState(decideAction.bind(null, listingId), initialDecisionState);

  return (
    <form action={formAction} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold">Your decision</h2>

      <label htmlFor="reason" className="mt-3 block text-sm font-medium">
        Reason (only needed to reject)
      </label>
      <textarea
        id="reason"
        name="reason"
        rows={3}
        defaultValue={state.reason}
        placeholder="What should the owner fix? They will see this message."
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      />

      <div className="mt-4 flex flex-wrap gap-3">
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
