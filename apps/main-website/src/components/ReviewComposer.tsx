"use client";

import { useState } from "react";

/**
 * Keeps the review form out of the way until someone wants it.
 *
 * The form used to sit open at the bottom of every business page, which gave a permanent block of
 * inputs to the many people who are reading reviews rather than writing one. It is one button now,
 * and the form appears under it.
 *
 * A disclosure rather than a dialog on purpose: the reviews stay on screen while you write, which
 * is what people check their wording against.
 */
export function ReviewComposer({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-black text-ink">Your review</h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="cursor-pointer text-sm font-bold text-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="cursor-pointer rounded-full bg-brand-700 px-6 py-3 text-sm font-extrabold text-white hover:bg-brand-800"
    >
      Give a review
    </button>
  );
}
