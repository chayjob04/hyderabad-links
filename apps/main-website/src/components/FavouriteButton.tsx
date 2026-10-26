"use client";

import { useActionState } from "react";
import { toggleFavouriteAction } from "@/app/[category]/[subcategory]/[slug]/actions";
import type { FavouriteState } from "@/app/[category]/[subcategory]/[slug]/report-state";

/**
 * Saves this listing to the signed-in person's list, or takes it off.
 *
 * A visitor who is not signed in gets a link to sign in that comes back here, rather than a button
 * that would fail: there is nowhere to keep a favourite for someone with no account.
 */
export function FavouriteButton({
  city,
  locality,
  slug,
  saved,
  signedIn,
  signInHref,
}: {
  city: string;
  locality: string;
  slug: string;
  saved: boolean;
  signedIn: boolean;
  signInHref: string;
}) {
  const [state, formAction, pending] = useActionState<FavouriteState>(
    () => toggleFavouriteAction({ city, locality, slug }, saved),
    { saved },
  );

  if (!signedIn) {
    return (
      <a
        href={signInHref}
        className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-6 py-3 text-sm font-extrabold text-brand-700 hover:border-brand-700 hover:bg-brand-50"
      >
        <span aria-hidden="true">&#9825;</span> Save
      </a>
    );
  }

  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        aria-pressed={saved}
        className={
          saved
            ? "inline-flex cursor-pointer items-center gap-2 rounded-full border border-brand-700 bg-brand-50 px-6 py-3 text-sm font-extrabold text-brand-800 hover:bg-brand-100 disabled:opacity-60"
            : "inline-flex cursor-pointer items-center gap-2 rounded-full border border-brand-200 bg-white px-6 py-3 text-sm font-extrabold text-brand-700 hover:border-brand-700 hover:bg-brand-50 disabled:opacity-60"
        }
      >
        <span aria-hidden="true">{saved ? "♥" : "♡"}</span>
        {pending ? "Saving..." : saved ? "Saved" : "Save"}
      </button>
      {state.message ? (
        <span role="alert" className="ml-2 text-sm font-medium text-red-700">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
