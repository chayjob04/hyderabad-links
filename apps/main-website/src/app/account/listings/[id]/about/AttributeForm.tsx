"use client";

import { useActionState } from "react";
import { addAttributeAction, type AboutState } from "./actions";

const INPUT =
  "w-full rounded-lg border border-line px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

type Props = {
  listingId: number;
  kind: string;
  heading: string;
  placeholder: string;
  /** Common answers, offered as one-click buttons. Empty for offerings, which are trade-specific. */
  suggestions: string[];
  /** Labels already on this list, so a suggestion already used is not offered again. */
  existing: string[];
  used: number;
  max: number;
};

/**
 * One of the three lists: offerings, languages or amenities.
 *
 * The suggestion buttons are the point of the design. The field is free text, because no fixed
 * list contains every service in Hyderabad — but left entirely free, five businesses write
 * "Telugu", "telugu", "Telugu speaking", "TELUGU" and "Telugu/English", and the labels stop being
 * worth anything to somebody comparing two listings. A one-click common spelling fixes most of
 * that without forbidding anything.
 *
 * Each suggestion is its own submit button carrying its value, so the whole thing works with no
 * client JavaScript.
 */
export function AttributeForm({
  listingId,
  kind,
  heading,
  placeholder,
  suggestions,
  existing,
  used,
  max,
}: Props) {
  const [state, formAction, pending] = useActionState<AboutState, FormData>(
    addAttributeAction.bind(null, listingId, kind),
    {},
  );

  const full = used >= max;
  const unused = suggestions.filter((s) => !existing.includes(s));

  return (
    <form action={formAction} className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-black text-ink">{heading}</h3>
        <span className="text-xs text-muted">
          {used} of {max}
        </span>
      </div>

      {full ? (
        <p className="mt-2 text-sm text-muted">
          That is the most we show. Remove one to add another.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <input name="label" placeholder={placeholder} aria-label={heading} className={`${INPUT} flex-1`} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-brand-700 px-5 py-2 text-sm font-black text-white hover:bg-brand-800 disabled:opacity-60"
            >
              {pending ? "Adding…" : "Add"}
            </button>
          </div>

          {unused.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-bold text-muted">Common ones:</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {unused.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="submit"
                    name="label"
                    value={suggestion}
                    disabled={pending}
                    className="rounded-full border border-line px-3 py-1 text-[13px] font-bold text-brand-700 transition hover:border-brand-700 hover:bg-brand-50 disabled:opacity-60"
                  >
                    + {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
