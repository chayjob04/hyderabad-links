"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * What a visitor sees when a public page throws while rendering.
 *
 * <b>Why it exists.</b> `getJson` in `lib/api.ts` throws `ApiResponseError` on any status but 200
 * and 404, and `fetch` itself throws when the API cannot be reached at all. Before this file there
 * was no error boundary anywhere in the application, so either of those took the visitor to
 * Next.js's own error screen: no header, no footer, no fonts, no way back, and the same blank page
 * for an outage as for a bug.
 *
 * Because it sits beside `layout.tsx` rather than replacing it, React renders this inside the root
 * layout — the visitor keeps the site header, the category menu and the footer, and can carry on
 * browsing while whatever broke is still broken. That is the point of putting it here and not
 * deeper: a failure on one page should cost that page, not the site.
 *
 * <b>Why it does not say what went wrong.</b> In a production build Next.js strips the error before
 * it reaches the browser — the message becomes a fixed string and only `digest`, a hash, survives.
 * So this component genuinely cannot tell a 500 from an unreachable API, and it does not pretend
 * to. Where that distinction can be made it is made on the server and kept there: `/search`
 * catches its own failure and says which of the two it was (see `search/page.tsx`). The digest is
 * shown when there is one, because it is the one thing that ties what a visitor saw to a line in
 * the server log.
 *
 * `reset()` re-runs the render of this segment. For an API that was briefly unreachable that is
 * the whole fix, which is why "Try again" comes first.
 */
export default function PublicPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /*
   * The server already logged the real error with its status and path. This logs what the browser
   * was handed, so a bug reported from a visitor's console can be matched to it by digest. It must
   * not be silent: swallowing an error here is how a programming mistake starts looking like an
   * outage.
   */
  useEffect(() => {
    console.error("A page failed to render", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-12">
      <EmptyState
        tone="error"
        mark="&#9888;"
        title="This page could not be loaded"
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button tone="primary" onClick={reset}>
              Try again
            </Button>
            <ButtonLink tone="ghost" href="/">
              Back to home
            </ButtonLink>
            <ButtonLink tone="ghost" href="/search">
              Browse businesses
            </ButtonLink>
          </div>
        }
      >
        <p>
          Something went wrong at our end while building this page. It is usually temporary, so
          trying again often works. Searching and browsing by category or area should still work in
          the meantime.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs">
            If you report this, quote reference <span className="font-mono">{error.digest}</span>.
          </p>
        ) : null}
      </EmptyState>
    </main>
  );
}
