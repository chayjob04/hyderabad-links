import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The staff site's 404.
 *
 * It is needed, rather than added for symmetry. Ten staff screens call `notFound()` on purpose —
 * `/admin/listings/[id]` and `/admin/blog/[id]` for an id that is not a number or that the API
 * answers 404 for, `/super-admin/accounts/[id]`, `/super-admin/admins/[id]` and the two listing
 * drill-downs for a slug that does not exist. Every one of those was rendering Next.js's built-in
 * 404 page: unstyled, unbranded, and with no link back to either dashboard, so a mistyped id ended
 * a moderator's session as far as they could tell.
 *
 * Both dashboards are offered for the same reason as in `error.tsx`: this cannot know which panel
 * the person came from, and the middleware redirects either link to the right sign-in if the
 * session has expired — which is itself a common way of arriving here.
 *
 * Tailwind rather than the theme's Bootstrap classes, because `app.min.css` is loaded inside
 * `AdminChrome`, which is below this boundary.
 */
export default function StaffNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
      <p className="text-sm font-bold tracking-widest text-neutral-500">
        HYDERABAD LINKS <span className="text-neutral-400">STAFF</span>
      </p>

      <h1 className="mt-6 text-2xl font-bold">That screen does not exist</h1>

      <p className="mt-3 text-sm text-neutral-600">
        The address may be mistyped, or the listing, account or post it pointed at may have been
        removed. Nothing has been changed.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/admin"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
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
