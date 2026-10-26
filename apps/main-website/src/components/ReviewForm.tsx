"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field, describedBy, fieldClass } from "@/components/ui/Field";
import { submitReviewAction } from "@/app/[category]/[subcategory]/[slug]/actions";
import { emptyReviewState } from "@/app/[category]/[subcategory]/[slug]/review-state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="cursor-pointer rounded-full bg-brand-700 px-6 py-3 text-sm font-extrabold text-white hover:bg-brand-800 disabled:opacity-60"
    >
      {pending ? "Sending..." : "Submit review"}
    </button>
  );
}

/** Writing a review. Signed-in visitors only, and nothing appears until a moderator approves it. */
export function ReviewForm({ city, locality, slug }: { city: string; locality: string; slug: string }) {
  const [state, formAction] = useActionState(submitReviewAction, emptyReviewState);
  const error = (field: string) => state.fieldErrors[field];

  if (state.submitted) {
    return (
      <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4">
        <p className="font-black text-green-900">Thank you &mdash; your review has been sent for checking.</p>
        <p className="mt-1 text-sm text-green-800">
          A moderator reads every review before it appears, so it will not show up straight away. You
          can see its progress under your account.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="city" value={city} />
      <input type="hidden" name="locality" value={locality} />
      <input type="hidden" name="slug" value={slug} />

      <p className="font-black text-ink">Write a review</p>

      {state.message ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800">
          {state.message}
        </p>
      ) : null}

      <Field id="rev-rating" label="Your rating" error={error("rating")}>
        <select
          id="rev-rating"
          name="rating"
          defaultValue={state.values.rating}
          required
          aria-invalid={error("rating") ? true : undefined}
          aria-describedby={describedBy("rev-rating", Boolean(error("rating")), false)}
          className={fieldClass}
        >
          <option value="">Choose a rating</option>
          <option value="5">5 — excellent</option>
          <option value="4">4 — good</option>
          <option value="3">3 — average</option>
          <option value="2">2 — poor</option>
          <option value="1">1 — very poor</option>
        </select>
      </Field>

      <Field
        id="rev-body"
        label="Your review"
        error={error("body")}
        help="What was your experience? This helps the next customer decide."
      >
        <textarea
          id="rev-body"
          name="body"
          rows={4}
          defaultValue={state.values.body}
          required
          minLength={20}
          maxLength={2000}
          aria-invalid={error("body") ? true : undefined}
          aria-describedby={describedBy("rev-body", Boolean(error("body")), true)}
          className={fieldClass}
        />
      </Field>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
