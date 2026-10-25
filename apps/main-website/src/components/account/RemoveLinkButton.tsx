"use client";

import { useActionState } from "react";
import { deleteLinkAction } from "@/app/account/listings/[id]/links/actions";
import type { LinkFormState } from "@/app/account/listings/[id]/links/form-state";

/** Removes one link. The confirmation is the browser's, because the removal cannot be undone. */
export function RemoveLinkButton({
  listingId,
  linkId,
  label,
}: {
  listingId: number;
  linkId: number;
  label: string;
}) {
  const [state, formAction, pending] = useActionState<LinkFormState>(
    () => deleteLinkAction(listingId, linkId),
    { rev: 0 },
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Remove “${label}”? This cannot be undone.`)) event.preventDefault();
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:border-red-300 hover:bg-red-50 disabled:cursor-default disabled:opacity-60"
      >
        {pending ? "Removing..." : "Remove"}
      </button>
      {state.message ? (
        <p role="alert" className="mt-1 text-xs font-medium text-red-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
