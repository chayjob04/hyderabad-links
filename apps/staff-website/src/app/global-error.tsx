"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * The staff site's last resort: the root layout itself threw.
 *
 * Same reasoning as the public site's copy — `error.tsx` renders inside the layout and so cannot
 * stand in for it. This replaces the document, carries its own `<html>` and `<body>`, imports the
 * stylesheet directly, and imports nothing else. The font variable is set on the layout's `<html>`
 * element, which is what is not rendering, so `--font-sans` falls through to Segoe UI.
 *
 * `reset()` is passed by Next.js and deliberately not taken: it re-mounts the tree that just
 * failed. A document reload is both more likely to help and what the person would try next.
 */
export default function StaffGlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("The staff root layout failed to render", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-4 text-center">
          <p className="text-sm font-bold tracking-widest text-neutral-500">
            HYDERABAD LINKS <span className="text-neutral-400">STAFF</span>
          </p>

          <h1 className="mt-8 text-2xl font-bold">The staff site could not be loaded</h1>

          <p className="mt-3 text-sm text-neutral-600">
            This is a fault at our end rather than anything you did, and no record has been changed
            by it.
          </p>

          {error.digest ? (
            <p className="mt-3 text-xs text-neutral-500">
              Reference <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
            >
              Reload the page
            </button>
            {/* A plain anchor: the router is part of what may be broken at this level. */}
            <a
              href="/login"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-neutral-500"
            >
              Go to sign in
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
