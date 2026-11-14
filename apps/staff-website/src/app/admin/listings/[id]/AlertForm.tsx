"use client";

import { useActionState } from "react";
import { sendAlertAction } from "../actions";
import { initialAlertState } from "../alert-state";

type Props = {
  listingId: number;
  /** The reasons the API accepts, keyed by stored code. Sent by the API, never listed here. */
  reasons: Record<string, string>;
};

/**
 * Asks the owner to fix something, without taking the listing down.
 *
 * `btn-warning` rather than a danger colour, and separate from the approve/reject form, because it
 * is a different kind of act: the business stays on the site and a person is being asked to do
 * something. Putting it next to "Reject" in the same red would invite it to be read as a warning
 * shot.
 *
 * The API checks the permission and validates both fields, so this form is never the control.
 */
export function AlertForm({ listingId, reasons }: Props) {
  const [state, formAction, pending] = useActionState(sendAlertAction.bind(null, listingId), initialAlertState);
  const entries = Object.entries(reasons);

  return (
    <form action={formAction}>
      <p className="text-muted font-size-13">
        The listing stays live. They see this in their dashboard and by email.
      </p>

      <div className="mb-3">
        <label htmlFor="reason" className="form-label">
          What is this about?
        </label>
        <select
          id="reason"
          name="reason"
          defaultValue={state.reason ?? entries[0]?.[0] ?? ""}
          className="form-select"
        >
          {entries.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label htmlFor="message" className="form-label">
          What should they change?
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          defaultValue={state.message}
          placeholder="Be specific. This is the only message they get, and nobody reads replies."
          className="form-control"
        />
      </div>

      <button type="submit" disabled={pending} formNoValidate className="btn btn-warning">
        {pending ? "Sending..." : "Send to the owner"}
      </button>

      {state.error ? (
        <div role="alert" className="alert alert-danger py-2 px-3 mt-3 mb-0 font-size-13">
          {state.error}
        </div>
      ) : null}
      {state.sent ? (
        <div role="status" className="alert alert-success py-2 px-3 mt-3 mb-0 font-size-13">
          Sent. It is listed beside this, and the owner has it in their dashboard.
        </div>
      ) : null}
    </form>
  );
}
