import type { Metadata } from "next";
import Link from "next/link";
import {
  LISTING_STATUSES,
  PERMISSION_LISTINGS_CREATE,
  describeStatus,
  formatWhen,
  getProfile,
  listListings,
} from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Listings" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string; done?: string }> };

const TONES: Record<string, string> = {
  grey: "bg-neutral-100 text-neutral-700",
  amber: "bg-amber-50 text-amber-800",
  green: "bg-green-50 text-green-800",
  red: "bg-red-50 text-red-800",
};

export default async function ListingsPage({ searchParams }: Props) {
  const { q, status, page: rawPage, done } = await searchParams;
  const page = Number.parseInt(rawPage ?? "1", 10);

  const [result, me] = await Promise.all([
    listListings({ q, status, page: Number.isSafeInteger(page) && page > 0 ? page : 1 }),
    getProfile(),
  ]);

  const mayAdd = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_CREATE);

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Listings</h1>
        {mayAdd ? (
          <Link
            href="/listings/new"
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            Add a listing
          </Link>
        ) : null}
      </div>
      <p className="mt-1 text-neutral-600">
        Every listing on the platform. Adding, correcting and removing one happens here; approving
        and rejecting what owners submit happens on the admin site.
      </p>

      {done ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
          {done}
        </p>
      ) : null}

      {/* A plain GET form, so the search and the filter end up in the URL and can be shared. */}
      <form className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[12rem] text-sm">
          <span className="font-medium">Search by name</span>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Smile Care"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">Status</span>
          <select name="status" defaultValue={status ?? ""} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2">
            <option value="">Any</option>
            {LISTING_STATUSES.map((value) => (
              <option key={value} value={value}>
                {describeStatus(value).label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
          Search
        </button>
      </form>

      {!result.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      ) : result.data.items.length === 0 ? (
        <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          No listings match that.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm text-neutral-600">
            {result.data.total} listing{result.data.total === 1 ? "" : "s"}, page {result.data.page} of{" "}
            {result.data.totalPages}
          </p>

          <ul className="mt-3 space-y-2">
            {result.data.items.map((listing) => {
              const tone = describeStatus(listing.status);
              return (
                <li key={listing.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link href={`/listings/${listing.id}`} className="font-semibold text-neutral-900 underline-offset-2 hover:underline">
                        {listing.name}
                      </Link>
                      <p className="mt-1 text-sm text-neutral-600">
                        {listing.categoryName ?? "No category"} &middot; {listing.localityName} &middot;{" "}
                        {listing.phonePrimary}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">Added {formatWhen(listing.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {listing.isVerified ? (
                        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-900">
                          Verified
                        </span>
                      ) : null}
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone.tone]}`}>
                        {tone.label}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <Pager page={result.data.page} totalPages={result.data.totalPages} q={q} status={status} />
        </>
      )}
    </main>
  );
}

function Pager({
  page,
  totalPages,
  q,
  status,
}: {
  page: number;
  totalPages: number;
  q?: string;
  status?: string;
}) {
  if (totalPages <= 1) return null;

  const href = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    query.set("page", String(target));
    return `/listings?${query.toString()}`;
  };

  return (
    <nav className="mt-6 flex items-center justify-between text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="rounded-lg border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-50">
          &larr; Previous
        </Link>
      ) : (
        <span />
      )}
      {page < totalPages ? (
        <Link href={href(page + 1)} className="rounded-lg border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-50">
          Next &rarr;
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
