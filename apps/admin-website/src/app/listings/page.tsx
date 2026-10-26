import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { PERMISSION_CREATE, QUEUE_STATUSES, describeStatus, formatWhen, getAdminProfile, getQueue } from "@/lib/admin-api";

export const metadata: Metadata = { title: "Moderation queue" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ status?: string; page?: string; decided?: string; added?: string }> };

export default async function ModerationQueuePage({ searchParams }: Props) {
  const { status: rawStatus, page: rawPage, decided } = await searchParams;

  // Anything unknown falls back to the review queue; the API validates the value again.
  const status = QUEUE_STATUSES.includes(rawStatus as (typeof QUEUE_STATUSES)[number]) ? rawStatus! : "pending_review";
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [result, me] = await Promise.all([getQueue(status, page), getAdminProfile()]);
  const mayAdd = me.ok && me.data.permissions.includes(PERMISSION_CREATE);

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Listings</h1>
        {mayAdd ? (
          <Link href="/listings/new" className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900">
            Add a listing
          </Link>
        ) : null}
      </div>
      <p className="mt-1 text-neutral-600">
        Owners submit listings for review. Nothing reaches the public site until someone approves it.
      </p>

      <nav aria-label="Filter by status" className="mt-5 flex flex-wrap gap-2">
        {QUEUE_STATUSES.map((value) => {
          const selected = value === status;
          return (
            <Link
              key={value}
              href={`/listings?status=${value}`}
              aria-current={selected ? "page" : undefined}
              className={
                selected
                  ? "rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              }
            >
              {describeStatus(value).label}
            </Link>
          );
        })}
      </nav>

      {decided ? (
        <p role="status" className="mt-5 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
          {decided === "approved" ? "Listing approved. It is live on the site now." : "Listing rejected. The owner can edit it and submit it again."}
        </p>
      ) : null}

      {!result.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      ) : result.data.items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold">
            {status === "pending_review" ? "Nothing is waiting for review" : "No listings with this status"}
          </h2>
          <p className="mt-1 text-neutral-600">
            {result.data.total > 0
              ? "That page is past the end of the list."
              : status === "pending_review"
                ? "Submitted listings appear here as soon as an owner sends one in."
                : "Try another status."}
          </p>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-neutral-600">
            {result.data.total} {result.data.total === 1 ? "listing" : "listings"}
            {status === "pending_review" ? ", oldest submission first" : ""}
          </p>

          <ul className="mt-3 grid gap-3">
            {result.data.items.map((listing) => (
              <li key={listing.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">
                      <Link href={`/listings/${listing.id}`} className="text-brand-900 underline-offset-2 hover:underline">
                        {listing.name}
                      </Link>
                    </h2>
                    <p className="mt-0.5 text-sm text-neutral-600">
                      {listing.categoryName ?? "No category"} &middot; {listing.localityName}
                    </p>
                    <p className="mt-1 text-sm text-neutral-500">
                      {listing.phonePrimary}
                      {listing.addressLine ? ` · ${listing.addressLine}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Whether this business is paying, which a reviewer could not see before.
                        It comes from the entitlement view, so it disappears the day a plan
                        lapses rather than showing what was once bought. */}
                    {listing.isVerified ? (
                      <span className="rounded-full bg-teal-700 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white uppercase">
                        Verified
                      </span>
                    ) : null}
                    <StatusBadge status={listing.status} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-neutral-500">
                    Submitted {formatWhen(listing.createdAt)} &middot; last change {formatWhen(listing.updatedAt)}
                  </p>
                  <Link
                    href={`/listings/${listing.id}`}
                    className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                  >
                    {listing.status === "pending_review" ? "Review" : "Open"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <Pagination page={result.data.page} totalPages={result.data.totalPages} params={{ status }} basePath="/listings" />
        </>
      )}
    </main>
  );
}
