import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import {
  PERMISSION_LISTINGS_EDIT,
  describeStatus,
  getCategoryCounts,
  getProfile,
  listListingsInCategory,
} from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Category" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

const TONES: Record<string, string> = {
  grey: "bg-neutral-100 text-neutral-700",
  amber: "bg-amber-50 text-amber-800",
  green: "bg-green-50 text-green-800",
  red: "bg-red-50 text-red-800",
};

/**
 * One category: its subcategories with counts, and anything filed directly on the category itself
 * — the original's `Super/ListingsByCategory/ViewByCategory`.
 *
 * The listing table here is deliberately short. Listings are filed under subcategories, so the
 * rows on a parent category are the odd ones out: a handful filed at the wrong level, usually by
 * an import. Seeing them is the point — the full list for a subcategory is one click further on.
 */
export default async function CategoryDrillPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { page: rawPage } = await searchParams;
  const page = Number.parseInt(rawPage ?? "1", 10);

  const [counts, listings, me] = await Promise.all([
    getCategoryCounts(),
    listListingsInCategory(slug, Number.isSafeInteger(page) && page > 0 ? page : 1),
    getProfile(),
  ]);

  const mayView = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);
  if (me.ok && !mayView) {
    return <AccessDenied permission={PERMISSION_LISTINGS_EDIT} what="listings by category" />;
  }

  if (!counts.ok) {
    return (
      <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {counts.message}
        </p>
      </main>
    );
  }

  const category = counts.data.find((row) => row.slug === slug && row.level === 1);
  if (!category) notFound();

  const children = counts.data
    .filter((row) => row.parentSlug === slug)
    .sort((a, b) => b.activeCount - a.activeCount);

  return (
    <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
      <Link href="/listings/by-category" className="text-sm font-semibold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> All categories
      </Link>

      <h1 className="mt-3 text-2xl font-bold">{category.name}</h1>
      <p className="mt-1 text-neutral-600">
        {children.length} {children.length === 1 ? "subcategory" : "subcategories"}
        {category.totalCount > 0
          ? ` · ${category.totalCount} filed directly on this category`
          : ""}
      </p>

      <section className="mt-6">
        <h2 className="text-base font-semibold">Subcategories</h2>
        {children.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">
            This category has no subcategories. Add one under Categories on the admin site before
            filing listings here.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-left">
              <thead className="bg-neutral-50 text-sm text-neutral-600">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Subcategory
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
                {children.map((child) => (
                  <tr key={child.slug} className={child.activeCount === 0 ? "bg-amber-50/40" : undefined}>
                    <th scope="row" className="px-4 py-3 font-semibold">
                      <Link
                        href={`/listings/by-subcategory/${child.slug}`}
                        className="text-brand-700 hover:underline"
                      >
                        {child.name}
                      </Link>
                      {!child.isActive ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                          RETIRED
                        </span>
                      ) : null}
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums">{child.activeCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                      {child.totalCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {listings.ok && listings.data.items.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-base font-semibold">Filed directly on {category.name}</h2>
          <p className="mt-1 text-sm text-neutral-600">
            These sit on the category itself rather than a subcategory, so they do not appear on any
            subcategory page. Usually worth moving.
          </p>
          <ul className="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white shadow-sm">
            {listings.data.items.map((listing) => {
              const tone = describeStatus(listing.status);
              return (
                <li key={listing.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Link
                    href={`/listings/${listing.id}`}
                    className="min-w-0 flex-1 font-semibold text-brand-700 hover:underline"
                  >
                    {listing.name}
                  </Link>
                  <span className="text-sm text-neutral-500">{listing.localityName}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${TONES[tone.tone] ?? TONES.grey}`}
                  >
                    {tone.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
