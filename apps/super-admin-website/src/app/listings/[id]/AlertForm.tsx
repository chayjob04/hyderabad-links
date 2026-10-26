"use client";

import { useActionState } from "react";
import { sendAlertAction } from "../actions";
import { initialAlertState } from "../form-state";

const sendButton =
  "rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60";

type Props = {
  listingId: number;
  /** The reasons the API accepts, keyed by stored code. Sent by the API, never listed here. */
  reasons: Record<string, string>;
};

/**
 * Asks the owner to fix something, without taking the listing down.
 *
 * A super admin could edit the listing themselves instead, and often should. This is for the
 * details only the business can confirm -- a phone number, an address -- where rewriting it on
 * their behalf is how a directory ends up confidently wrong.
 *
 * The API checks the permission and validates both fields, so this form is never the control.
 */
export function AlertForm({ listingId, reasons }: Props) {
  const [state, formAction, pending] = useActionState(sendAlertAction.bind(null, listingId), initialAlertState);
  const entries = Object.entries(reasons);

  return (
    <form action={formAction} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold">Ask the owner to change something</h2>
      <p className="mt-1 text-sm text-neutral-600">
        The listing stays live. They see this in their dashboard and by email.
      </p>

      <label htmlFor="reason" className="mt-3 block text-sm font-medium">
        What is this about?
      </label>
      <select
        id="reason"
        name="reason"
        defaultValue={state.reason ?? entries[0]?.[0] ?? ""}
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      >
        {entries.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label htmlFor="message" className="mt-3 block text-sm font-medium">
        What should they change?
      </label>
      <textarea
        id="message"
        name="message"
        rows={4}
        defaultValue={state.message}
        placeholder="Be specific. This is the only message they get, and nobody reads replies."
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      />

      <div className="mt-4">
        <button type="submit" disabled={pending} formNoValidate className={sendButton}>
          {pending ? "Sending..." : "Send to the owner"}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.sent ? (
        <p role="status" className="mt-3 text-sm text-green-700">
          Sent. It is listed below, and the owner has it in their dashboard.
        </p>
      ) : null}
    </form>
  );
}
