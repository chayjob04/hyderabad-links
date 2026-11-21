"use client";

import { useActionState, useState } from "react";
import { renameLinkAction } from "@/app/account/listings/[id]/links/actions";
import type { LinkFormState } from "@/app/account/listings/[id]/links/form-state";

/**
 * Renames one link the listing already has — the Verified plan's "make your own field", applied to
 * what is already there.
 *
 * <b>Why it is inline and not a page.</b> Renaming is a one-field edit to a row the owner is already
 * looking at. A separate screen for it would mean leaving the list, and the list is the context
 * that makes the name make sense.
 *
 * It starts closed: the common case on this screen is reading the links, not editing one, and six
 * open text boxes would read as a form rather than a list. Only the label is sent; the API will not
 * accept anything else through this route, so a bug here cannot move or repoint a link.
 */
export function RenameLinkForm({
  listingId,
  linkId,
  label,
}: {
  listingId: number;
  linkId: number;
  /** The stored name, which is what an owner who may rename is already seeing. */
  label: string;
}) {
  const [requested, setRequested] = useState(false);
  const [state, formAction, pending] = useActionState<LinkFormState, FormData>(
    (previous, formData) => renameLinkAction(listingId, linkId, previous, formData),
    { rev: 0 },
  );

  /* Derived rather than stored. A successful save closes the form, and writing that as
     `setOpen(false)` during render would be setting state while rendering — legal in React but the
     kind of legal that becomes a loop after one careless edit. The action revalidates the page, so
     the new name is already on screen behind this. */
  const open = requested && !state.success;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setRequested(true)}
        className="cursor-pointer text-sm font-bold text-brand-700 hover:underline"
      >
        Rename
      </button>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
      <span className="sr-only" id={`rename-${linkId}-hint`}>
        Rename this link
      </span>
      {/* Full width on a phone, a fixed 12rem from `sm` up. It was `w-48` at every size, which
          overflowed the row at 375px: the field plus Save plus Cancel need about 340px, and the
          list row that holds them has 40px of padding inside a 375px viewport. */}
      <input
        name="label"
        defaultValue={label}
        maxLength={80}
        aria-label="Link name"
        aria-describedby={`rename-${linkId}-hint`}
        aria-invalid={state.fieldErrors?.label ? true : undefined}
        className="w-full min-w-0 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink outline-none focus:border-brand-700 sm:w-48"
      />
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-full bg-brand-700 px-4 py-1.5 text-sm font-extrabold text-white hover:bg-brand-800 disabled:cursor-default disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setRequested(false)}
        className="cursor-pointer px-1 py-1.5 text-sm font-bold text-muted hover:text-ink hover:underline"
      >
        Cancel
      </button>

      {/* Field errors and the plan refusing are both shown here. The API's own wording is used for
          the second, because it is the side that knows the entitlement. */}
      {state.fieldErrors?.label ?? state.message ? (
        <p role="alert" className="basis-full text-sm font-bold text-red-700">
          {state.fieldErrors?.label ?? state.message}
        </p>
      ) : null}
    </form>
  );
}
