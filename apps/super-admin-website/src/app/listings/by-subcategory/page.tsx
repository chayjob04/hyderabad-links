import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/AccessDenied";
import { PERMISSION_LISTINGS_EDIT, getCategoryCounts, getProfile } from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Listings by subcategory" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ empty?: string }> };

/**
 * Every subcategory with its listing count — the original's
 * `Super/ListingsByCategory/BySubCategory`.
 *
 * This is the level listings are actually filed at, so it is the level where "thin" matters: a
 * subcategory with nothing on it is a page in the navigation that leads to an empty result, and
 * there are usually more of those than anyone expects. The `?empty=1` filter exists to make that
 * list short enough to act on in one sitting.
 *
 * Same rows as the by-category screen, read one level down, so the two cannot disagree about a
 * number.
 */
export default async function ListingsBySubcategoryPage({ searchParams }: Props) {
  const { empty } = await searchParams;
  const onlyEmpty = empty === "1";

  const [result, me] = await Promise.all([getCategoryCounts(), getProfile()]);
  const mayView = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);

  if (me.ok && !mayView) {
    return <AccessDenied permission={PERMISSION_LISTINGS_EDIT} what="listings by subcategory" />;
  }

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
        <h1 className="text-2xl font-bold">Listings by subcategory</h1>
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      </main>
    );
  }

  const all = result.data
    .filter((row) => row.level === 2)
    .sort((a, b) => b.activeCount - a.activeCount || a.name.localeCompare(b.name));

  const emptyCount = all.filter((row) => row.activeCount === 0).length;
  const rows = onlyEmpty ? all.filter((row) => row.activeCount === 0) : all;

  return (
    <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Listings by subcategory</h1>
        <Link href="/listings/by-category" className="text-sm font-semibold text-brand-700 hover:underline">
          By category &rarr;
        </Link>
      </div>
      <p className="mt-1 text-neutral-600">
        {all.length} subcategories, busiest first. {emptyCount} have nothing live on them.
      </p>

      <p className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/listings/by-subcategory"
          aria-current={onlyEmpty ? undefined : "page"}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
            onlyEmpty
              ? "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
              : "bg-neutral-900 text-white"
          }`}
        >
          All
        </Link>
        <Link
          href="/listings/by-subcategory?empty=1"
          aria-current={onlyEmpty ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
            onlyEmpty
              ? "bg-neutral-900 text-white"
              : "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
          }`}
        >
          Empty only ({emptyCount})
        </Link>
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-green-800">
          Every subcategory has at least one live listing.
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left">
            <thead className="bg-neutral-50 text-sm text-neutral-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Subcategory
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  In
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Live
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  All statuses
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rows.map((row) => (
                <tr key={row.slug} className={row.activeCount === 0 ? "bg-amber-50/40" : undefined}>
                  <th scope="row" className="px-4 py-3 font-semibold">
                    <Link
                      href={`/listings/by-subcategory/${row.slug}`}
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
                  <td className="px-4 py-3 text-sm text-neutral-600">{row.parentName ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.activeCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{row.totalCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
