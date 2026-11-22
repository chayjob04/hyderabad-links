import type { ReactNode } from "react";
import { LockIcon } from "@/components/account/VerifiedFeatures";
import type { SectionCompletion } from "@/lib/listing-completion";

/**
 * One collapsible part of the listing editor.
 *
 * A native `<details>`, for the same reason the public FAQs are: it opens and closes with no
 * JavaScript, it is keyboard accessible for free, and it survives a form inside it posting and the
 * page re-rendering. A hand-rolled accordion would need client state, and that state would be lost
 * on every save -- which is exactly when the owner is looking at it.
 *
 * The section the owner most likely wants is opened for them: `defaultOpen` is set by the editor for
 * the first section that is not finished, so arriving at a half-built listing shows the gap rather
 * than a column of closed headings.
 */
type Props = {
  title: string;
  /** One line on what this section is for, shown under the title when open. */
  blurb?: string;
  completion: SectionCompletion;
  defaultOpen?: boolean;
  /**
   * Set when the plan does not include this section. The heading says so and carries a padlock; the
   * contents are still rendered, because the screen behind the padlock is where the feature is
   * explained and where upgrading is offered. A feature you cannot see is a feature you cannot want.
   */
  locked?: boolean;
  /** Replaces the percentage when counting it would be misleading -- a locked section, say. */
  badge?: string;
  children: ReactNode;
};

export function ListingSection({
  title,
  blurb,
  completion,
  defaultOpen = false,
  locked = false,
  badge,
  children,
}: Props) {
  const done = completion.percent === 100;

  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-line bg-white shadow-[0_8px_22px_#002a340b] open:shadow-[0_10px_28px_#002a3414]"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 marker:hidden">
        <span className="flex min-w-0 items-center gap-2">
          {locked ? <LockIcon className="size-3.5 shrink-0 text-muted" /> : null}
          <span className="text-base font-black text-ink">{title}</span>
        </span>

        <span className="flex shrink-0 items-center gap-3">
          {badge ? (
            <span className="text-xs font-black tracking-[0.08em] text-muted uppercase">{badge}</span>
          ) : (
            <>
              {/* A bar as well as a number: the figure is the precise answer and the bar is the one
                  you can read at a glance down a column of sections. */}
              <span
                aria-hidden="true"
                className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-line sm:block"
              >
                <span
                  className={`block h-full rounded-full ${done ? "bg-green-600" : "bg-brand-700"}`}
                  style={{ width: `${completion.percent}%` }}
                />
              </span>
              <span
                className={`text-sm font-black tabular-nums ${done ? "text-green-700" : "text-brand-700"}`}
              >
                {completion.percent}%
              </span>
            </>
          )}
          <span
            aria-hidden="true"
            className="text-muted transition-transform group-open:rotate-45"
          >
            +
          </span>
        </span>
      </summary>

      <div className="border-t border-line px-5 py-5">
        {blurb ? <p className="mb-4 text-sm text-muted">{blurb}</p> : null}

        {/* Named, not just counted. "60%" tells an owner there is work left; this tells them what. */}
        {completion.missing.length > 0 ? (
          <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-black">Still to add:</span> {completion.missing.join(", ")}.
          </p>
        ) : null}

        {children}
      </div>
    </details>
  );
}
