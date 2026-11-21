import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingNav } from "@/components/account/ListingNav";
import { UpgradeModal } from "@/components/account/UpgradeModal";
import { LockIcon } from "@/components/account/VerifiedFeatures";
import { EmptyState } from "@/components/ui/EmptyState";
import { rupees } from "@/lib/format";
import { getListingSubscription, getMyListing } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Ads" };

type Props = { params: Promise<{ id: string }> };

/**
 * Ads: the other Verified feature that is not finished.
 *
 * <b>Nothing here advertises anything and nothing here takes money.</b> There is no ad inventory,
 * no booking and no second payment path — see `UpgradeModal` for why there is exactly one of those
 * in this project. This page describes what advertising will be and says plainly that it is not
 * open, which is what an owner can act on: nothing, yet.
 *
 * Same shape as Promote, deliberately. The two are at the same stage, and two screens that explain
 * the same situation differently would read as one of them knowing something the other does not.
 */
export default async function ListingAdsPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listingResult, subscriptionResult] = await Promise.all([
    getMyListing(id),
    getListingSubscription(id),
  ]);

  if (!listingResult.ok) {
    if (listingResult.status === 404) notFound();   // also what another owner's listing looks like
    return (
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <EmptyState tone="error" mark="&#9888;" title="We could not load this listing">
          <p>{listingResult.message}</p>
        </EmptyState>
      </main>
    );
  }

  const listing = listingResult.data;
  const plan = subscriptionResult.ok ? subscriptionResult.data : null;
  const paidPlan = plan?.paidPlan ?? null;

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <p className="text-[11px] font-black tracking-[0.22em] text-muted uppercase">Listing</p>
      <h1 className="mt-1 flex items-center gap-2 text-2xl font-black tracking-tight text-brand-800 sm:text-3xl">
        {!listing.verified ? <LockIcon className="size-5 shrink-0 text-muted" /> : null}
        Ads
      </h1>
      <p className="mt-1 font-bold text-muted">{listing.name}</p>

      <ListingNav listingId={id} current="ads" verified={listing.verified} />

      <section className="mt-8 rounded-2xl border border-line bg-white px-6 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-black text-brand-800">Advertise this business</h2>
          <span className="rounded-full border border-line px-3 py-1 text-[11px] font-black tracking-[0.12em] text-muted uppercase">
            Coming soon
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          You will be able to explore advertising for this listing from here: where an ad could
          appear across HYDERABAD LINKS, what each placement costs, and what it is worth for a
          business like yours. Nothing is booked or charged without you choosing it.
        </p>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          Advertising is not open yet, so there is nothing to set up on this page today.
        </p>

        {!listing.verified ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm text-muted">
              Ads are part of the Verified listing. Upgrading now also unlocks photos, video, your
              logo and your own link names, which are ready to use today.
            </p>
            <div className="mt-3">
              {paidPlan ? (
                <UpgradeModal
                  listingId={id}
                  priceLabel={rupees(paidPlan.pricePaise)}
                  featureTitle="Ads"
                  featureBenefit="Explore advertising for this listing across HYDERABAD LINKS. Advertising is not open yet; upgrading now unlocks photos, video, your logo and your own link names straight away."
                  paymentsLive={plan?.paymentsAvailable ?? false}
                  trigger={
                    <button
                      type="button"
                      className="cursor-pointer rounded-full bg-brand-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-800"
                    >
                      Upgrade to Verified
                    </button>
                  }
                />
              ) : (
                <Link
                  href={`/account/listings/${id}/subscription`}
                  className="inline-block rounded-full bg-brand-700 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-800"
                >
                  See plans and prices
                </Link>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
            Included in your Verified listing. Nothing to do yet.
          </p>
        )}
      </section>
    </main>
  );
}
