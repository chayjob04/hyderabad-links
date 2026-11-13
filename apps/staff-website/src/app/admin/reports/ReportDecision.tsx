"use client";

import { useActionState } from "react";
import { decideReportAction } from "./actions";
import { initialReportDecisionState } from "./decision-state";

/**
 * Closes one report. The note is for other moderators, not for the reporter — a reporter is never
 * told what was decided, since that would turn the queue into a way of probing the site.
 *
 * On the theme's form classes; the behaviour is unchanged.
 */
export function ReportDecision({ reportId }: { reportId: number }) {
  const [state, formAction, pending] = useActionState(
    decideReportAction.bind(null, reportId),
    initialReportDecisionState,
  );

  return (
    <form action={formAction} className="border-top mt-3 pt-3">
      <label htmlFor={`report-note-${reportId}`} className="form-label">
        Note for the team (optional)
      </label>
      <textarea
        id={`report-note-${reportId}`}
        name="note"
        rows={2}
        defaultValue={state.note}
        placeholder="What did you find, and what did you do about it?"
        className="form-control"
      />

      <div className="d-flex flex-wrap gap-2 mt-3">
        <button type="submit" name="intent" value="action" disabled={pending} className="btn btn-primary">
          {pending ? "Saving..." : "I dealt with it"}
        </button>
        <button type="submit" name="intent" value="dismiss" disabled={pending} className="btn btn-outline-secondary">
          Nothing wrong
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
