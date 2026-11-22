import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState, FilterTabs } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  ALL_STATUSES,
  LISTING_PLANS,
  QUEUE_STATUSES,
  describeStatus,
  formatWhen,
  getAdminProfile,
  getQueue,
  type ListingPlan,
} from "@/lib/admin-api";

export const metadata: Metadata = { title: "Moderation queue" };
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    status?: string;
    plan?: string;
    page?: string;
    decided?: string;
    added?: string;
  }>;
};

/**
 * The moderation queue, on the original's Minia layout.
 *
 * The rows were a `<ul>` of bordered boxes; they are a table now, which is what the original uses
 * for every list of listings, and which is also what put the stray bullet beside each card once
 * Bootstrap's list styling came back. The queue, the filters and the paging are unchanged — same
 * API call, same statuses, same URL-as-state.
 */
export default async function ModerationQueuePage({ searchParams }: Props) {
  const { status: rawStatus, plan: rawPlan, page: rawPage, decided } = await searchParams;

  // Anything unknown falls back to the review queue; the API validates the value again.
  const known = QUEUE_STATUSES.includes(rawStatus as (typeof QUEUE_STATUSES)[number]);
  const status = known || rawStatus === ALL_STATUSES ? rawStatus! : "pending_review";
  const plan = LISTING_PLANS.includes(rawPlan as ListingPlan) ? (rawPlan as ListingPlan) : undefined;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [result, me] = await Promise.all([getQueue(status, page, plan), getAdminProfile()]);

  /* The two filters are independent, so changing one keeps the other. Page is deliberately not
     carried over: the first page of a different filter is where you want to be. */
  const filterHref = (next: { status?: string; plan?: string }) => {
    const query = new URLSearchParams({ status: next.status ?? status });
    const wanted = next.plan === undefined ? plan : next.plan;
    if (wanted) query.set("plan", wanted);
    return `/admin/listings?${query.toString()}`;
  };

  const heading = status === ALL_STATUSES ? "All listings" : describeStatus(status).label;

  return (
    <>
      <PageTitle title="Listings" breadcrumb={[{ label: "Listings" }, { label: heading }]} />

      <div className="row mb-3">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-1">Moderation queue</h4>
              <p className="card-title-desc mb-3">
                Owners submit listings for review. Nothing reaches the public site until someone
                approves it.
              </p>

              <FilterTabs
                tabs={[
                  { value: ALL_STATUSES, label: "All" },
                  ...QUEUE_STATUSES.map((value) => ({ value, label: describeStatus(value).label })),
                ]}
                current={status}
                hrefFor={(value) => filterHref({ status: value })}
              />

              {/* The plan, on its own row of the same tabs the statuses use -- this is what the
                  Free Listings and Verified Listings menu rows open. Verified means paid up right
                  now, from the entitlement view, not what the listing once bought. */}
              <FilterTabs
                label="Filter by plan"
                tabs={[
                  { value: "", label: "All plans" },
                  { value: "free", label: "Free" },
                  { value: "verified", label: "Verified" },
                ]}
                current={plan ?? ""}
                hrefFor={(value) => filterHref({ plan: value })}
              />

              {decided ? (
                <div role="status" className="alert alert-success">
                  {decided === "approved"
                    ? "Listing approved. It is live on the site now."
                    : "Listing rejected. The owner can edit it and submit it again."}
                </div>
              ) : null}

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.message}
                </div>
              ) : result.data.items.length === 0 ? (
                <EmptyState
                  icon="bx bx-check-double"
                  title={
                    status === "pending_review"
                      ? "Nothing is waiting for review"
                      : "No listings with this status"
                  }
                >
                  {result.data.total > 0
                    ? "That page is past the end of the list."
                    : status === "pending_review"
                      ? "Submitted listings appear here as soon as an owner sends one in."
                      : "Try another status."}
                </EmptyState>
              ) : (
                <>
                  <p className="text-muted font-size-13">
                    {result.data.total} {result.data.total === 1 ? "listing" : "listings"}
                    {status === "pending_review" ? ", oldest submission first" : ""}
                  </p>

                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Listing</th>
                          <th scope="col">Category</th>
                          <th scope="col">Contact</th>
                          {/* Fixed width so the badge column does not shuffle as statuses change
                              length between "Live" and "Waiting for review". */}
                          <th scope="col" className="text-center" style={{ width: "10rem" }}>
                            Status
                          </th>
                          <th scope="col">Submitted</th>
                          <th scope="col">Last change</th>
                          <th scope="col" className="text-end">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.items.map((listing) => (
                          <tr key={listing.id}>
                            <td className="py-3">
                              <div className="d-flex align-items-center gap-2">
                                <Link
                                  href={`/admin/listings/${listing.id}`}
                                  className="fw-semibold text-body"
                                >
                                  {listing.name}
                                </Link>
                                {/* Whether this business is paying, which a reviewer could not see
                                    before. It comes from the entitlement view, so it disappears the
                                    day a plan lapses rather than showing what was once bought. */}
                                {listing.isVerified ? (
                                  <span className="badge bg-primary-subtle text-primary">Verified</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="py-3 text-muted">
                              {listing.categoryName ?? "No category"}
                              <span className="d-block font-size-12">{listing.localityName}</span>
                            </td>
                            {/* Phone and address on their own lines: run together they read as one
                                string, and the address is the longer of the two. */}
                            <td className="py-3 text-muted">
                              <span className="d-block text-nowrap">{listing.phonePrimary}</span>
                              {listing.addressLine ? (
                                <span className="d-block font-size-12">{listing.addressLine}</span>
                              ) : null}
                            </td>
                            <td className="py-3 text-center">
                              <StatusBadge status={listing.status} />
                            </td>
                            <td className="py-3 text-muted font-size-13 text-nowrap">
                              {formatWhen(listing.createdAt)}
                            </td>
                            <td className="py-3 text-muted font-size-13 text-nowrap">
                              {formatWhen(listing.updatedAt)}
                            </td>
                            <td className="py-3 text-end">
                              <Link
                                href={`/admin/listings/${listing.id}`}
                                className="btn btn-sm btn-primary"
                              >
                                {listing.status === "pending_review" ? "Review" : "Open"}
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    page={result.data.page}
                    totalPages={result.data.totalPages}
                    params={{ status }}
                    basePath="/admin/listings"
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
