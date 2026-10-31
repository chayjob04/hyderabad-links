"use client";

import { useActionState } from "react";
import type { OpeningInterval } from "@/lib/owner-api";
import { saveHoursAction, type HoursState } from "./actions";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const INPUT =
  "rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

/**
 * The week, as seven rows of time inputs.
 *
 * Two sets per day, because a lunch break is the common case and anything more is rare enough not
 * to be worth the clutter. A day left blank is closed — there is no "closed" checkbox, so the form
 * cannot end up saying a day is open while its times are empty.
 *
 * `<input type="time">` rather than a custom picker: it is a native control, it is already
 * keyboard and screen-reader accessible, and on a phone it opens the system time wheel, which is
 * what an owner filling this in on a phone actually wants.
 */
export function HoursForm({ listingId, initial }: { listingId: number; initial: OpeningInterval[] }) {
  const [state, formAction, pending] = useActionState<HoursState, FormData>(
    saveHoursAction.bind(null, listingId),
    {},
  );

  /** The first and second interval stored for a day, if any. */
  const slotsFor = (day: number) => {
    const forDay = initial.filter((i) => i.dayOfWeek === day);
    return { a: forDay[0], b: forDay[1] };
  };

  return (
    <form action={formAction} className="rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]">
      <p className="text-sm text-muted">
        Leave a day blank if you are closed. Use the second row only if you close in the middle of
        the day. Times that run past midnight are fine &mdash; put <strong>18:00</strong> to{" "}
        <strong>02:00</strong>.
      </p>

      <div className="mt-5 grid gap-3">
        {DAYS.map((name, day) => {
          const { a, b } = slotsFor(day);
          return (
            <div key={name} className="grid gap-2 border-b border-line pb-3 sm:grid-cols-[120px_1fr] sm:items-center">
              <span className="text-sm font-black text-ink">{name}</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  name={`opens-${day}a`}
                  defaultValue={a?.opens ?? ""}
                  aria-label={`${name} opening time`}
                  className={INPUT}
                />
                <span aria-hidden="true" className="text-muted">
                  &ndash;
                </span>
                <input
                  type="time"
                  name={`closes-${day}a`}
                  defaultValue={a?.closes ?? ""}
                  aria-label={`${name} closing time`}
                  className={INPUT}
                />

                <input
                  type="time"
                  name={`opens-${day}b`}
                  defaultValue={b?.opens ?? ""}
                  aria-label={`${name} second opening time`}
                  className={`${INPUT} ml-2`}
                />
                <span aria-hidden="true" className="text-muted">
                  &ndash;
                </span>
                <input
                  type="time"
                  name={`closes-${day}b`}
                  defaultValue={b?.closes ?? ""}
                  aria-label={`${name} second closing time`}
                  className={INPUT}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-brand-700 px-6 py-2.5 text-sm font-black text-white hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save hours"}
        </button>
        {state.saved ? (
          <p role="status" className="text-sm font-bold text-green-700">
            Saved. Your listing now shows whether you are open.
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
