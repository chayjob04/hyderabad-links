"use client";

import { useActionState } from "react";
import { decideReportAction } from "./actions";
import { initialReportDecisionState } from "./decision-state";

const actionButton =
  "rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60";
const dismissButton =
  "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-60";

/**
 * Closes one report. The note is for other moderators, not for the reporter — a reporter is never
 * told what was decided, since that would turn the queue into a way of probing the site.
 */
export function ReportDecision({ reportId }: { reportId: number }) {
  const [state, formAction, pending] = useActionState(
    decideReportAction.bind(null, reportId),
    initialReportDecisionState,
  );

  return (
    <form action={formAction} className="mt-4 border-t border-neutral-200 pt-4">
      <label htmlFor={`report-note-${reportId}`} className="block text-sm font-medium">
        Note for the team (optional)
      </label>
      <textarea
        id={`report-note-${reportId}`}
        name="note"
        rows={2}
        defaultValue={state.note}
        placeholder="What did you find, and what did you do about it?"
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      />

      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" name="intent" value="action" disabled={pending} className={actionButton}>
          {pending ? "Saving..." : "I dealt with it"}
        </button>
        <button type="submit" name="intent" value="dismiss" disabled={pending} className={dismissButton}>
          Nothing wrong
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
