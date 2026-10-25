import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UpgradeButton } from "@/components/account/UpgradeButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { getListingSubscription, getMyListing } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Plan and payment" };

type Props = { params: Promise<{ id: string }> };

/** Paise to rupees, the way a price is written here: 39900 → ₹399. */
function rupees(paise: number): string {
  const whole = paise / 100;
  return `₹${whole.toLocaleString("en-IN", { maximumFractionDigits: whole % 1 === 0 ? 0 : 2 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * This listing's plan, and how to buy or renew the paid one.
 *
 * Everything shown here comes from the API, which derives it from the subscription period against
 * the clock. This page decides nothing about expiry: a lapsed listing arrives as `free` with the
 * date it ended, so the wording can explain what happened without this side having to work it out.
 */
export default async function ListingSubscriptionPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listingResult, subscriptionResult] = await Promise.all([
    getMyListing(id),
    getListingSubscription(id),
  ]);

  if (!listingResult.ok || !subscriptionResult.ok) {
    const failed = !listingResult.ok ? listingResult : subscriptionResult;
    if (failed.ok === false && failed.status === 404) notFound();   // also what another owner's listing looks like
    return (
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <EmptyState tone="error" mark="&#9888;" title="We could not load this listing&rsquo;s plan">
          <p>{failed.ok === false ? failed.message : ""}</p>
        </EmptyState>
      </main>
    );
  }

  const listing = listingResult.data;
  const plan = subscriptionResult.data;
  const paidPlan = plan.paidPlan;

  // Lapsed: nothing is in force, but this listing did buy the paid plan at some point. The date is
  // what makes that readable rather than a silent downgrade.
  const lapsed = !plan.verified && plan.subscribedPlanSlug !== "free";
  const publishable = listing.status === "active" || listing.status === "pending_review" || listing.status === "suspended";

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <p className="text-[11px] font-black tracking-[0.22em] text-muted uppercase">Listing</p>
      <h1 className="mt-1 text-2xl font-black tracking-tight text-brand-800 sm:text-3xl">Plan and payment</h1>
      <p className="mt-1 font-bold text-muted">{listing.name}</p>

      <nav className="mt-4 flex flex-wrap gap-3 text-sm font-bold">
        <Link href={`/account/listings/${id}/edit`} className="text-brand-700 hover:underline">
          Edit details
        </Link>
        <Link href={`/account/listings/${id}/photos`} className="text-brand-700 hover:underline">
          Photos and video
        </Link>
        <Link href={`/account/listings/${id}/links`} className="text-brand-700 hover:underline">
          Website and social links
        </Link>
        <Link href="/account/listings" className="text-muted hover:underline">
          All listings
        </Link>
      </nav>

      {/* ------------------------------------------------------------ what is in force now */}
      <section className="mt-8 rounded-2xl border border-line bg-white px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-black tracking-[0.18em] text-muted uppercase">Current plan</p>
            <p className="mt-1 text-xl font-black text-brand-800">{plan.planName}</p>
          </div>
          {plan.verified ? (
            <span className="rounded-full bg-brand-700 px-4 py-1.5 text-xs font-black tracking-wide text-white uppercase">
              Verified
            </span>
          ) : null}
        </div>

        {plan.verified && plan.paidUntil ? (
          <p className="mt-3 text-sm text-muted">
            Verified until {formatDate(plan.paidUntil)}. Renewing before then adds a full period to
            what is left, so nothing is lost by renewing early.
          </p>
        ) : lapsed ? (
          <p className="mt-3 text-sm text-muted">
            This listing&rsquo;s Verified plan has ended, so it is on the Free plan now. The photos,
            videos and links already saved are all still here &mdash; they are simply not shown on
            the public page until the plan is renewed.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">
            The Free plan keeps this listing on the directory with its name, category, area and phone
            number.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------ what the paid plan buys */}
      {paidPlan ? (
        <section className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 px-6 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-black text-brand-800">{paidPlan.name} plan</h2>
            <p className="text-lg font-black text-brand-800">
              {rupees(paidPlan.pricePaise)}
              <span className="text-sm font-bold text-muted">
                {paidPlan.periodMonths === 12 ? " a year" : ` for ${paidPlan.periodMonths} months`}
              </span>
            </p>
          </div>

          <ul className="mt-4 grid gap-2 text-sm font-medium text-ink sm:grid-cols-2">
            <li>The Verified badge on your public page</li>
            <li>Up to {paidPlan.photoLimit} photos and a logo</li>
            <li>Up to {paidPlan.videoLimit} videos</li>
            <li>Up to {paidPlan.linkLimit} website and social links</li>
          </ul>

          <div className="mt-5">
            {!publishable ? (
              // Taking the money before there is a public page to put a badge on would leave the
              // owner wondering where it went.
              <p className="text-sm font-bold text-muted">
                Submit this listing for review first. Once it is published you can add the Verified
                plan from here.
              </p>
            ) : !plan.paymentsAvailable ? (
              /* No provider configured. The plan and its price are still shown, because they are
                 real, but there is no button: sending someone into a checkout that cannot complete
                 is worse than telling them it is not ready. */
              <p className="text-sm font-bold text-muted">
                Online payment is not switched on yet. Nothing can be charged from this page today.
              </p>
            ) : (
              <UpgradeButton
                listingId={id}
                priceLabel={rupees(paidPlan.pricePaise)}
                renewal={plan.verified || lapsed}
              />
            )}
          </div>

          <p className="mt-4 text-xs text-muted">
            Payment is taken by Razorpay. Card and UPI details are entered in their window and never
            reach HYDERABAD LINKS.
          </p>
        </section>
      ) : (
        <p className="mt-6 text-sm text-muted">There is no paid plan on sale at the moment.</p>
      )}
    </main>
  );
}
