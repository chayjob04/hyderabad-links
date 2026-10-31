"use client";

import { useActionState } from "react";
import { addContentAction, addFaqAction, type AboutState } from "./actions";

const INPUT =
  "mt-1 w-full rounded-lg border border-line px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

const BUTTON =
  "rounded-full bg-brand-700 px-6 py-2.5 text-sm font-black text-white hover:bg-brand-800 disabled:opacity-60";

type Props = {
  listingId: number;
  /** Null hides the form and shows why. `limit` 0 means the plan does not include this at all. */
  limit: number;
  used: number;
  planName: string;
};

/**
 * Why the form is hidden, or null when it should be shown.
 *
 * Two different situations with two different answers: a Free listing should be told what the paid
 * plan adds, while a Verified one that is simply full should be told to remove something. Saying
 * "not allowed" to both would leave the paying owner with no idea what to do.
 */
function blockedReason(limit: number, used: number, planName: string): string | null {
  if (limit === 0) {
    return `The ${planName} plan does not include these. The Verified plan does.`;
  }
  if (used >= limit) {
    return `You have used all ${limit}. Remove one to add another.`;
  }
  return null;
}

export function AddFaqForm({ listingId, limit, used, planName }: Props) {
  const [state, formAction, pending] = useActionState<AboutState, FormData>(
    addFaqAction.bind(null, listingId),
    {},
  );

  const blocked = blockedReason(limit, used, planName);
  if (blocked) {
    return <p className="rounded-lg border border-line bg-brand-50/50 px-4 py-3 text-sm text-muted">{blocked}</p>;
  }

  return (
    <form action={formAction} className="rounded-lg border border-line p-4">
      <label htmlFor="question" className="block text-sm font-bold text-ink">
        Question
      </label>
      <input id="question" name="question" placeholder="Do you deliver?" className={INPUT} />

      <label htmlFor="answer" className="mt-3 block text-sm font-bold text-ink">
        Answer
      </label>
      <textarea id="answer" name="answer" rows={3} className={INPUT} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Adding…" : "Add question"}
        </button>
        <span className="text-xs text-muted">
          {used} of {limit} used
        </span>
      </div>

      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function AddContentForm({ listingId, limit, used, planName }: Props) {
  const [state, formAction, pending] = useActionState<AboutState, FormData>(
    addContentAction.bind(null, listingId),
    {},
  );

  const blocked = blockedReason(limit, used, planName);
  if (blocked) {
    return <p className="rounded-lg border border-line bg-brand-50/50 px-4 py-3 text-sm text-muted">{blocked}</p>;
  }

  return (
    <form action={formAction} className="rounded-lg border border-line p-4">
      <label htmlFor="heading" className="block text-sm font-bold text-ink">
        Heading
      </label>
      <input id="heading" name="heading" placeholder="About us" className={INPUT} />

      <label htmlFor="body" className="mt-3 block text-sm font-bold text-ink">
        Text
      </label>
      {/* Plain text, not HTML. Enforced in the API and the database, because this is published to
          a public page and owners are the least-trusted authors on the platform. */}
      <p className="text-xs text-muted">Plain text. Your line breaks are kept.</p>
      <textarea id="body" name="body" rows={5} className={INPUT} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Adding…" : "Add section"}
        </button>
        <span className="text-xs text-muted">
          {used} of {limit} used
        </span>
      </div>

      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
