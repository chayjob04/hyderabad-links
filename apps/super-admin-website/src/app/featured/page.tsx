import type { Metadata } from "next";
import Link from "next/link";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import {
  PERMISSION_LISTINGS_FEATURE,
  formatWhen,
  getFeatured,
  getProfile,
} from "@/lib/super-admin-api";
import { removeFromShelfAction } from "./actions";

export const metadata: Metadata = { title: "Featured", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

/**
 * The homepage Featured shelf, in the order visitors see it.
 *
 * This page only removes. Adding happens from a listing's own page, because choosing a business to
 * recommend means looking at it first — a picker on this screen would invite choosing from a list of
 * names, which is how the wrong shop ends up on the front page.
 *
 * Trending is not here, and has no screen anywhere: it is counted from enquiries, favourites and
 * approved reviews over the last 30 days. A homepage where one shelf is curated and the other is
 * earned only works if nobody can touch the earned one.
 */
export default async function FeaturedPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me] = await Promise.all([getFeatured(), getProfile()]);
  const mayFeature = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_FEATURE);

  return (
    <SuperAdminChrome>
      <main className="mx-auto max-w-4xl px-4 pt-8 pb-16">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Homepage Featured shelf</h1>
          {/* The way in. Adding happens from the listings page, where each row has a Feature
              toggle, so this page needs to say where that is rather than leaving someone looking
              for an "add" button that is deliberately not here. */}
          <Link
            href="/listings?status=active"
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            Add listings &rarr;
          </Link>
        </div>
        <p className="mt-2 text-sm text-neutral-600">
          Chosen by hand, newest choice first. Featuring a listing again moves it to the front. To
          add one, open <strong>Listings</strong> and use the <strong>Feature</strong> toggle on any
          live listing.
        </p>

        {done ? (
          <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            {done}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {!result.ok ? (
          <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {result.message}
          </p>
        ) : (
          <>
            <p className="mt-6 text-sm text-neutral-700">
              {result.data.items.length} of {result.data.max} slots used.{" "}
              {result.data.remaining === 0
                ? "The shelf is full: take one off before adding another."
                : `${result.data.remaining} free.`}
            </p>

            {result.data.items.length === 0 ? (
              <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
                <p className="font-semibold text-neutral-900">Nothing is featured yet.</p>
                <p className="mt-2">
                  The homepage shows no Featured section until something is on this shelf. Open{" "}
                  <Link href="/listings?status=active" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                    Listings
                  </Link>{" "}
                  and switch <strong>Feature</strong> on for any live business.
                </p>
              </div>
            ) : (
              <ul className="mt-4 grid gap-3">
                {result.data.items.map((row, index) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900">
                        <span className="mr-2 text-neutral-400">{index + 1}.</span>
                        <Link href={`/listings/${row.id}`} className="underline-offset-2 hover:underline">
                          {row.name}
                        </Link>
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        Chosen {formatWhen(row.featuredAt)}
                        {row.featuredBy ? ` by ${row.featuredBy}` : ""}
                        {/* A featured listing can be suspended afterwards. The homepage drops it
                            immediately, but it stays on the shelf until somebody takes it off, so
                            this row has to say why it is not showing. */}
                        {row.status !== "active" ? ` · ${row.status.replace("_", " ")}, so it is not showing` : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
                        >
                          Public page
                        </a>
                      ) : null}
                      {mayFeature ? (
                        <form action={removeFromShelfAction.bind(null, row.id)}>
                          <button
                            type="submit"
                            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                          >
                            Take off
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {!mayFeature ? (
          <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
            Your account can see the shelf but not change it. It needs the &quot;Choose which
            listings appear on the homepage Featured shelf&quot; permission.
          </p>
        ) : null}
      </main>
    </SuperAdminChrome>
  );
}
