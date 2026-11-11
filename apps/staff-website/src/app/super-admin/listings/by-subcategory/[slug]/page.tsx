import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import {
  PERMISSION_LISTINGS_EDIT,
  describeStatus,
  formatWhen,
  getCategoryCounts,
  getProfile,
  listListingsInCategory,
} from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Subcategory" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

const TONES: Record<string, string> = {
  grey: "bg-neutral-100 text-neutral-700",
  amber: "bg-amber-50 text-amber-800",
  green: "bg-green-50 text-green-800",
  red: "bg-red-50 text-red-800",
};

/**
 * Every listing filed under one subcategory — the original's
 * `Super/ListingsByCategory/ViewBySubCategory`.
 *
 * All statuses, not only the live ones. A subcategory that looks empty on the public site but holds
 * nine listings awaiting review is a queue problem, not a content problem, and the two need telling
 * apart before anybody goes looking for businesses to add.
 */
export default async function SubcategoryDrillPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { page: rawPage } = await searchParams;
  const page = Number.parseInt(rawPage ?? "1", 10);
  const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1;

  const [counts, listings, me] = await Promise.all([
    getCategoryCounts(),
    listListingsInCategory(slug, currentPage),
    getProfile(),
  ]);

  const mayView = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);
  if (me.ok && !mayView) {
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="listings by subcategory" />;
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

  const subcategory = counts.data.find((row) => row.slug === slug && row.level === 2);
  if (!subcategory) notFound();

  return (
    <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
      <Link
        href="/super-admin/listings/by-subcategory"
        className="text-sm font-semibold text-brand-700 hover:underline"
      >
        <span aria-hidden="true">&larr;</span> All subcategories
      </Link>

      <h1 className="mt-3 text-2xl font-bold">{subcategory.name}</h1>
      <p className="mt-1 text-neutral-600">
        {subcategory.parentName ? (
          <>
            In{" "}
            <Link
              href={`/super-admin/listings/by-category/${subcategory.parentSlug}`}
              className="font-semibold text-brand-700 hover:underline"
            >
              {subcategory.parentName}
            </Link>{" "}
            &middot;{" "}
          </>
        ) : null}
        {subcategory.activeCount} live of {subcategory.totalCount} filed
      </p>

      {!listings.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {listings.message}
        </p>
      ) : listings.data.items.length === 0 ? (
        <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-amber-900">
          Nothing is filed under this subcategory. It is a live page on the public site that returns
          no results.
        </p>
      ) : (
        <>
          <ul className="mt-6 divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white shadow-sm">
            {listings.data.items.map((listing) => {
              const tone = describeStatus(listing.status);
              return (
                <li key={listing.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/super-admin/listings/${listing.id}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {listing.name}
                    </Link>
                    <p className="text-sm text-neutral-500">
                      {listing.localityName} &middot; added {formatWhen(listing.createdAt)}
                    </p>
                  </div>
                  {listing.isVerified ? (
                    <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">
                      Verified
                    </span>
                  ) : null}
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${TONES[tone.tone] ?? TONES.grey}`}
                  >
                    {tone.label}
                  </span>
                </li>
              );
            })}
          </ul>

          {listings.data.totalPages > 1 ? (
            <nav className="mt-6 flex items-center justify-between gap-4" aria-label="Pages">
              {currentPage > 1 ? (
                <Link
                  href={`/super-admin/listings/by-subcategory/${slug}?page=${currentPage - 1}`}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  &larr; Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-neutral-600">
                Page {listings.data.page} of {listings.data.totalPages}
              </span>
              {currentPage < listings.data.totalPages ? (
                <Link
                  href={`/super-admin/listings/by-subcategory/${slug}?page=${currentPage + 1}`}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  Next &rarr;
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}
