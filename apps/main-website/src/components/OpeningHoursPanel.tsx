import type { OpenStatus, OpeningHours } from "@/lib/types";

type Props = {
  hours: OpeningHours[];
  status: OpenStatus | null;
};

/** "18:00" reads as "6:00 pm" to most people looking up a shop. */
function friendly(time: string): string {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${twelve}${suffix}` : `${twelve}:${minute}${suffix}`;
}

/**
 * When a business is open, and whether it is open right now.
 *
 * The status comes from the API already decided. This component never computes it, which is the
 * whole point: these are wall-clock times in Hyderabad, and a browser working it out would tell a
 * visitor in London that a shop is shut because of where *they* are standing.
 *
 * Several intervals on one day are shown on one line — "9am–1pm, 4pm–8pm" — because that is how a
 * sign in a window reads, and a day with no intervals says Closed rather than being left blank.
 */
export function OpeningHoursPanel({ hours, status }: Props) {
  if (hours.length === 0) {
    // No hours recorded is not the same as closed. Saying nothing is the honest answer.
    return null;
  }

  // One row per day, Monday first, so the table has seven rows whether or not each has hours.
  const byDay = Array.from({ length: 7 }, (_, day) => ({
    day,
    name: hours.find((h) => h.dayOfWeek === day)?.dayName ?? "",
    intervals: hours.filter((h) => h.dayOfWeek === day),
  }));

  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  return (
    <section className="rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <h2 className="text-lg font-black text-brand-800">Opening hours</h2>
        {status ? (
          <span
            className={`rounded-full px-3 py-1 text-xs font-black ${
              status.isOpenNow ? "bg-green-100 text-green-900" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {status.isOpenNow ? "Open now" : "Closed"}
          </span>
        ) : null}
      </div>

      {status ? (
        <p className="mt-3 text-sm text-muted">
          {status.isOpenNow && status.closesAt
            ? `Closes at ${friendly(status.closesAt)}.`
            : status.opensAt
              ? `Opens ${status.opensDay === "today" || status.opensDay === "tomorrow" ? status.opensDay : `on ${status.opensDay}`} at ${friendly(status.opensAt)}.`
              : null}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-1.5">
        {byDay.map(({ day, intervals }) => (
          <div key={day} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="font-bold text-ink">{dayNames[day]}</dt>
            <dd className={intervals.length === 0 ? "text-muted" : "text-ink"}>
              {intervals.length === 0
                ? "Closed"
                : intervals.map((i) => `${friendly(i.opens)}–${friendly(i.closes)}`).join(", ")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
