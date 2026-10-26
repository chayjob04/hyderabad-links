import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { rupees } from "@/lib/format";
import { getSubscriptions } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Plans and payment" };


function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Every listing's plan in one place, with the paid plan explained once.
 *
 * This is the sidebar item that was deliberately left out while `subscriptions` did not exist, on
 * the rule that every item in the dashboard must reach a working page. The table exists now, and so
 * does a way to buy the plan, so it is here.
 *
 * The plan state for each listing is whatever the API reports — derived from the subscription period
 * against the clock — so a lapsed listing arrives as Free with the date it ended, and this page does
 * not work out expiry for itself.
 */
export default async function SubscriptionsPage() {
  const result = await getSubscriptions();
  if (!result.ok) {
    return (
      <>
        <EmptyState tone="error" mark="&#9888;" title="We could not load your plans">
          <p>{result.message}</p>
        </EmptyState>
      </>
    );
  }

  const { items, paidPlan, paymentsAvailable } = result.data;
  const verifiedCount = items.filter((item) => item.verified).length;

  return (
    <>
      <h1 className="text-2xl font-black text-ink">Plans and payment</h1>
      <p className="mt-1 text-muted">
        Each listing has its own plan, so you can verify one business without paying for all of them.
      </p>

      {paidPlan ? (
        <section className="mt-7 rounded-2xl border border-brand-200 bg-brand-50 px-6 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-black text-brand-800">{paidPlan.name} plan</h2>
            <p className="text-lg font-black text-brand-800">
              {rupees(paidPlan.pricePaise)}
              <span className="text-sm font-bold text-muted">
                {paidPlan.periodMonths === 12 ? " a year, per listing" : ` for ${paidPlan.periodMonths} months, per listing`}
              </span>
            </p>
          </div>
          <ul className="mt-4 grid gap-2 text-sm font-medium text-ink sm:grid-cols-2">
            <li>The Verified badge on the public page</li>
            <li>Up to {paidPlan.photoLimit} photos and a logo</li>
            <li>Up to {paidPlan.videoLimit} videos</li>
            <li>Up to {paidPlan.linkLimit} website and social links</li>
          </ul>
          {!paymentsAvailable ? (
            <p className="mt-4 text-sm font-bold text-muted">
              Online payment is not switched on yet, so nothing can be charged today.
            </p>
          ) : null}
        </section>
      ) : null}

      {items.length === 0 ? (
        <div className="mt-7">
          <EmptyState mark="&#128269;" title="No listings yet">
            <p>
              A plan belongs to a listing, so there is nothing to show until you have one.{" "}
              <Link href="/account/listings/new" className="font-bold text-brand-700 hover:underline">
                Create your first listing
              </Link>
              .
            </p>
          </EmptyState>
        </div>
      ) : (
        <>
          <p className="mt-8 text-sm font-bold text-muted">
            {verifiedCount} of {items.length} {items.length === 1 ? "listing" : "listings"} verified
          </p>

          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white">
            {items.map((item) => (
              <li key={item.listingId} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-black text-ink">{item.listingName}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {item.planName} plan
                    {item.verified && item.paidUntil
                      ? ` · until ${formatDate(item.paidUntil)}`
                      : !item.verified && item.subscribedPlanSlug !== "free" && item.paidUntil
                        ? ` · Verified ended ${formatDate(item.paidUntil)}`
                        : ""}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {item.verified ? (
                    <span className="rounded-full bg-brand-700 px-3 py-1 text-[11px] font-black tracking-wide text-white uppercase">
                      Verified
                    </span>
                  ) : null}
                  <Link
                    href={`/account/listings/${item.listingId}/subscription`}
                    className="text-sm font-black text-brand-700 hover:underline"
                  >
                    {item.verified ? "Manage" : "Get Verified"} <span aria-hidden="true">&rarr;</span>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
