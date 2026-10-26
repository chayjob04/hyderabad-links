"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { reportListingAction } from "@/app/[category]/[subcategory]/[slug]/actions";
import { emptyReportState } from "@/app/[category]/[subcategory]/[slug]/report-state";
import { REPORT_REASONS } from "@/lib/api";

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="cursor-pointer rounded-full bg-brand-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-800 disabled:opacity-60"
    >
      {pending ? "Sending..." : "Send report"}
    </button>
  );
}

/**
 * "Report this listing", folded away until someone wants it.
 *
 * It is behind a toggle rather than always open because almost every visitor is here to find a
 * plumber, not to complain; and it needs no account, because requiring one would mean most problems
 * never get reported at all.
 */
export function ReportListing({ city, locality, slug }: { city: string; locality: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(reportListingAction, emptyReportState);
  const error = (field: string) => state.fieldErrors[field];

  if (state.sent) {
    return (
      <p role="status" className="mt-8 text-center text-sm text-muted">
        Thank you. A moderator will look at this listing.
      </p>
    );
  }

  if (!open) {
    return (
      <p className="mt-8 text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer text-sm font-bold text-muted underline-offset-2 hover:text-brand-700 hover:underline"
        >
          Report a problem with this listing
        </button>
      </p>
    );
  }

  return (
    <section aria-labelledby="report-heading" className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 id="report-heading" className="text-lg font-black text-ink">
        Report a problem
      </h2>
      <p className="mt-1 text-sm text-muted">
        Tell us what is wrong and a moderator will check it. You do not need an account.
      </p>

      <form action={formAction} className="mt-4 grid max-w-xl gap-4">
        <input type="hidden" name="city" value={city} />
        <input type="hidden" name="locality" value={locality} />
        <input type="hidden" name="slug" value={slug} />

        {state.message ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800">
            {state.message}
          </p>
        ) : null}

        <div>
          <label htmlFor="report-reason" className="block text-sm font-bold text-ink">
            What is wrong?
          </label>
          <select
            id="report-reason"
            name="reason"
            defaultValue={state.values.reason}
            required
            aria-invalid={error("reason") ? true : undefined}
            aria-describedby={error("reason") ? "report-reason-error" : undefined}
            className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base outline-none focus:border-brand-700"
          >
            <option value="">Choose a reason</option>
            {REPORT_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
          {error("reason") ? (
            <p id="report-reason-error" className="mt-1 text-sm font-medium text-red-700">
              {error("reason")}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="report-details" className="block text-sm font-bold text-ink">
            Anything else? <span className="font-medium text-muted">(needed if you chose &ldquo;Something else&rdquo;)</span>
          </label>
          <textarea
            id="report-details"
            name="details"
            rows={3}
            defaultValue={state.values.details}
            maxLength={2000}
            aria-invalid={error("details") ? true : undefined}
            aria-describedby={error("details") ? "report-details-error" : undefined}
            className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base outline-none focus:border-brand-700"
          />
          {error("details") ? (
            <p id="report-details-error" className="mt-1 text-sm font-medium text-red-700">
              {error("details")}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SendButton />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="cursor-pointer text-sm font-bold text-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
