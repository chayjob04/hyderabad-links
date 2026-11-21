"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * The last resort: the root layout itself threw.
 *
 * `error.tsx` renders *inside* the layout, so it cannot help when the layout is what failed — at
 * that point there is no `<html>`, no stylesheet and no site chrome to render into. This file
 * replaces the document, which is why it carries its own `<html>` and `<body>` and why it imports
 * the stylesheet directly.
 *
 * It is deliberately plain. Nothing here reads data, no component is imported, and the only
 * styling used is what `globals.css` defines for itself — the fonts come from `next/font` on the
 * layout's `<html>` element, which by definition is not rendering, so `--font-sans` falls through
 * to Segoe UI and system-ui and the page still looks deliberate. Every dependency added here is
 * another thing that can be broken at the moment this page is needed.
 *
 * Next.js also passes a `reset()` here. It is deliberately not taken: it re-mounts the same tree
 * that just failed, and at document level that is the tree that was broken. The action reloads the
 * document instead, which is both more likely to work and what a visitor would try next anyway.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("The root layout failed to render", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-white font-sans text-ink antialiased">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-4 text-center">
          <p className="text-lg font-black tracking-tight text-brand-800">
            HYDERABAD <span className="text-brand-700">LINKS</span>
          </p>

          <h1 className="mt-8 text-3xl font-black tracking-tight text-ink">Something went wrong</h1>

          <p className="mt-3 text-muted">
            The site could not be loaded at all just now. This is at our end, not yours, and it is
            usually temporary.
          </p>

          {error.digest ? (
            <p className="mt-3 text-xs text-muted">
              If you report this, quote reference <span className="font-mono">{error.digest}</span>.
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {/*
              A full document reload, not reset(): whatever broke the layout will break it again on
              a re-render of the same tree, and a reload is also what a visitor would try next.
            */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-full bg-brand-700 px-6 py-3 text-sm font-extrabold text-white transition-colors hover:bg-brand-800"
            >
              Reload the page
            </button>
            {/*
              A plain anchor rather than next/link. The router is part of what may be broken here,
              and this has to work without it.
            */}
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-line bg-white px-6 py-3 text-sm font-extrabold text-brand-700 transition-colors hover:border-brand-700 hover:bg-brand-50"
            >
              Back to home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
