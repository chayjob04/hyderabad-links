"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * What a member of staff sees when a screen throws while rendering.
 *
 * <b>What this is not for.</b> An API failure does not reach here. `send` in `lib/admin-api.ts`
 * and its super-admin twin catch an unreachable API and return `{ ok: false, status: 0 }`, so every
 * screen already renders its own message for that and keeps its sidebar while doing it. This
 * boundary is for the other kind: a genuine fault in the application — a value that was not the
 * shape the screen assumed, a date that would not parse, a bug. Before this file those reached
 * Next.js's own error screen, which tells a moderator nothing and offers them nowhere to go.
 *
 * <b>Why it offers both surfaces.</b> A server component cannot read the path, and this one
 * deliberately holds no state about which panel the person came from, so it cannot know whether to
 * send them to /admin or /super-admin. Offering both is honest; guessing would strand half of the
 * people who see it. The links are plain `Link`s to the dashboards, and the middleware turns either
 * one into the right sign-in if the session has gone — which is the other thing that brings
 * somebody here.
 *
 * The styling is Tailwind, not the Minia theme's Bootstrap classes, and that is not an oversight:
 * `app.min.css` is loaded by `MiniaStyles` inside `AdminChrome`, which lives below this boundary.
 * A `card` and a `btn btn-primary` written here would render unstyled. See the note in the
 * implementation report about keeping the sidebar on these screens.
 */
export default function StaffError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /*
   * Staff screens are the ones where a silent failure costs most — a moderator who cannot tell a
   * bug from an empty queue will assume the queue is empty. The server logged the real error; this
   * records what the browser was given, with the digest that ties the two together.
   */
  useEffect(() => {
    console.error("A staff screen failed to render", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
      <p className="text-sm font-bold tracking-widest text-neutral-500">
        HYDERABAD LINKS <span className="text-neutral-400">STAFF</span>
      </p>

      <div
        role="alert"
        className="mt-6 rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center"
      >
        <span aria-hidden="true" className="text-3xl text-red-700">
          &#9888;
        </span>
        <h1 className="mt-2 text-xl font-bold text-red-900">This screen could not be loaded</h1>
        <p className="mt-2 text-sm text-red-800">
          Something went wrong while building the page. Nothing you were doing has been saved, and
          no record has been changed by this failure.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-red-800">
            Reference <span className="font-mono">{error.digest}</span> — quote it when reporting
            this.
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
        >
          Try again
        </button>
        <Link
          href="/admin"
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-neutral-500"
        >
          Admin dashboard
        </Link>
        <Link
          href="/super-admin/overview"
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-neutral-500"
        >
          Super Admin overview
        </Link>
      </div>
    </main>
  );
}
