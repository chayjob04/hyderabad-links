import type { Metadata } from "next";
import Link from "next/link";
import { PlanBanner } from "@/components/PlanBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { describeStatus, getSubscriptions, listMyListings } from "@/lib/owner-api";
import type { OwnerListing } from "@/lib/owner-api";

export const metadata: Metadata = { title: "My listings" };

const MAX_LISTINGS = 5; // same limit the API enforces

type Props = { searchParams: Promise<{ submitted?: string; welcome?: string }> };

/**
 * The counts across the top.
 *
 * Every one is worked out from the listings the API just returned - there is no view count, no
 * rating and no blog here, because none of those exist in the database. The prototype's dashboard
 * shows three such tiles permanently reading zero; showing a number nobody can ever change would
 * be worse than showing nothing.
 */
function statusCounts(listings: OwnerListing[]) {
  return [
    { label: "Live", count: listings.filter((l) => l.status === "active").length },
    { label: "In review", count: listings.filter((l) => l.status === "pending_review").length },
    { label: "Drafts", count: listings.filter((l) => l.status === "draft").length },
    { label: "Needs changes", count: listings.filter((l) => l.status === "rejected").length },
  ];
}

export default async function MyListingsPage({ searchParams }: Props) {
  const { submitted, welcome } = await searchParams;

  /* Two requests, in parallel. The listings carry each one's plan; this adds the paid plan's price,
     which lives in the `plans` table, so the banner can say "₹399/year" without the figure being
     typed into a component. A failure here is not worth failing the page for: the banner simply
     names the plan without a price. */
  const [result, subscriptions] = await Promise.all([listMyListings(), getSubscriptions()]);
  const paidPlan = subscriptions.ok ? subscriptions.data.paidPlan : null;

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <h1 className="text-3xl font-black tracking-tight text-brand-800">My listings</h1>
        <div className="mt-6">
          <EmptyState tone="error" mark="&#9888;" title="We could not load your listings">
            <p>{result.message}</p>
          </EmptyState>
        </div>
      </main>
    );
  }

  const listings = result.data;
  const canAddMore = listings.length > 0 && listings.length < MAX_LISTINGS;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-[11px] font-black tracking-[0.22em] text-muted">BUSINESS OWNER</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-brand-800">My listings</h1>
        </div>
        {canAddMore ? <ButtonLink href="/account/listings/new">Add a business</ButtonLink> : null}
      </div>

      {welcome ? (
        <div role="status" className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4">
          <p className="font-black text-brand-800">
            <span aria-hidden="true">&#10003;</span> Your account is ready.
          </p>
          <p className="mt-1 text-sm text-muted">
            We saved your business below. Add the address and a description, and saving will send
            it to us for review — there is no separate button to press.
          </p>
        </div>
      ) : null}

      {submitted ? (
        <p role="status" className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800">
          Submitted for review. We will show your listing on the site once it is approved.
        </p>
      ) : null}

      {listings.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            mark="&#8962;"
            title="You have not added a business yet"
            action={
              <ButtonLink tone="cta" href="/account/listings/new">
                Add your business <span aria-hidden="true">&rarr;</span>
              </ButtonLink>
            }
          >
            <p>It takes a few minutes. Customers nearby will be able to call or WhatsApp you.</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <dl className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {statusCounts(listings).map((stat) => (
              <div key={stat.label} className="rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]">
                <dt className="text-xs font-black tracking-[0.12em] text-muted uppercase">{stat.label}</dt>
                <dd className="mt-1 text-3xl font-black text-brand-700">{stat.count}</dd>
              </div>
            ))}
          </dl>

          <ul className="mt-6 grid gap-5 lg:grid-cols-2">
            {listings.map((listing) => (
              <li
                key={listing.id}
                className="flex flex-col rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]"
              >
                <PlanBanner
                  planSlug={listing.planSlug}
                  planName={listing.planName}
                  verified={listing.verified}
                  pricePaise={paidPlan?.pricePaise}
                  periodMonths={paidPlan?.periodMonths}
                />

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg leading-snug font-black text-ink">{listing.name}</h2>
                    <p className="mt-1 text-xs font-black tracking-[0.1em] text-muted uppercase">
                      {listing.categoryName} &middot; {listing.localityName}
                    </p>
                  </div>
                  <StatusBadge status={listing.status} />
                </div>

                <p className="mt-3 text-sm text-muted">{describeStatus(listing.status).help}</p>

                {listing.status === "rejected" && listing.reviewNote ? (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                    <span className="font-black">What to change:</span> {listing.reviewNote}
                  </p>
                ) : null}

                {/* Amber, not red: the listing is still live and nothing has been taken down —
                    somebody has asked for a correction, which is a different thing from a
                    rejection and has to look like one. */}
                {listing.openAlerts > 0 ? (
                  <Link
                    href={`/account/listings/${listing.id}/alerts`}
                    className="mt-3 block rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:border-amber-500"
                  >
                    <span className="font-black">
                      {listing.openAlerts === 1
                        ? "We have asked you to change something"
                        : `We have asked you to change ${listing.openAlerts} things`}
                    </span>{" "}
                    &mdash; read {listing.openAlerts === 1 ? "it" : "them"}{" "}
                    <span aria-hidden="true">&rarr;</span>
                  </Link>
                ) : null}

                <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <Link
                    href={`/account/listings/${listing.id}/edit`}
                    className="rounded-full border border-brand-200 px-5 py-2 text-sm font-bold text-brand-700 hover:border-brand-700 hover:bg-brand-50"
                  >
                    {listing.status === "draft" || listing.status === "rejected" ? "Finish and send for review" : "Edit"}
                  </Link>
                  <Link
                    href={`/account/listings/${listing.id}/hours`}
                    className="text-sm font-black text-brand-700 hover:underline"
                  >
                    Opening hours
                  </Link>
                  {listing.status === "active" ? (
                    <Link href={listing.url} className="text-sm font-black text-brand-700 hover:underline">
                      View public page <span aria-hidden="true">&rarr;</span>
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {listings.length >= MAX_LISTINGS ? (
        <p className="mt-5 text-sm text-muted">You have reached the limit of {MAX_LISTINGS} listings.</p>
      ) : null}
    </main>
  );
}
