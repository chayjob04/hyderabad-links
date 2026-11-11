import type { Metadata } from "next";
import Link from "next/link";
import { PERMISSION_LISTINGS_EDIT, getCategoryCounts, getProfile } from "@/lib/super-admin-api";
import { AccessDenied } from "@/components/AccessDenied";

export const metadata: Metadata = { title: "Listings by category" };
export const dynamic = "force-dynamic";

/**
 * How many businesses sit under each top-level category — the original's
 * `Super/ListingsByCategory/ByCategory`.
 *
 * The flat listing list cannot answer the question this one exists for: where is the directory
 * thin? A category page with two businesses on it is a page not worth arriving at, and that stays
 * invisible for as long as listings are only ever shown newest-first.
 *
 * A top-level category's count is its own plus every subcategory beneath it. Listings are filed
 * under subcategories in practice, so a parent's own count is almost always zero and showing that
 * alone would say "Food: 0" over four hundred restaurants.
 *
 * Only the primary category is counted. A listing may appear under several, but counting every
 * association would make the column add up to more than the number of listings — and the question
 * here is what somebody would find on that page.
 */
export default async function ListingsByCategoryPage() {
  const [result, me] = await Promise.all([getCategoryCounts(), getProfile()]);
  const mayView = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);

  if (me.ok && !mayView) {
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="listings by category" />;
  }

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
        <h1 className="text-2xl font-bold">Listings by category</h1>
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      </main>
    );
  }

  const parents = result.data.filter((row) => row.level === 1);
  const children = result.data.filter((row) => row.level === 2);

  /* A parent's totals, rolled up from its children plus anything filed directly on it. Computed
     here rather than in SQL so the by-subcategory screen reads exactly the same rows. */
  const rolled = parents
    .map((parent) => {
      const mine = children.filter((child) => child.parentSlug === parent.slug);
      return {
        ...parent,
        subcategories: mine.length,
        activeCount: parent.activeCount + mine.reduce((sum, child) => sum + child.activeCount, 0),
        totalCount: parent.totalCount + mine.reduce((sum, child) => sum + child.totalCount, 0),
      };
    })
    .sort((a, b) => b.activeCount - a.activeCount);

  const liveTotal = rolled.reduce((sum, row) => sum + row.activeCount, 0);

  return (
    <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Listings by category</h1>
        <Link href="/super-admin/listings/by-subcategory" className="text-sm font-semibold text-brand-700 hover:underline">
          By subcategory &rarr;
        </Link>
      </div>
      <p className="mt-1 text-neutral-600">
        {liveTotal} live {liveTotal === 1 ? "listing" : "listings"} across {rolled.length}{" "}
        categories, busiest first. A category with very few is a thin page &mdash; worth filling
        before it is promoted.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-neutral-50 text-sm text-neutral-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Category
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Live
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                All statuses
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Subcategories
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {rolled.map((row) => (
              <tr key={row.slug} className={row.activeCount === 0 ? "bg-amber-50/40" : undefined}>
                <th scope="row" className="px-4 py-3 font-semibold">
                  <Link
                    href={`/super-admin/listings/by-category/${row.slug}`}
                    className="text-brand-700 hover:underline"
                  >
                    {row.name}
                  </Link>
                  {!row.isActive ? (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                      RETIRED
                    </span>
                  ) : null}
                </th>
                <td className="px-4 py-3 text-right tabular-nums">{row.activeCount}</td>
                {/* The gap between the two columns is the useful part: a category with 40 filed
                    and 3 live has 37 sitting in review or suspended. */}
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{row.totalCount}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{row.subcategories}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
