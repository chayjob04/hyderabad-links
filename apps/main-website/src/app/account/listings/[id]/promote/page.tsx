import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingNav } from "@/components/account/ListingNav";
import { UpgradeModal } from "@/components/account/UpgradeModal";
import { LockIcon } from "@/components/account/VerifiedFeatures";
import { EmptyState } from "@/components/ui/EmptyState";
import { rupees } from "@/lib/format";
import { getListingSubscription, getMyListing } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Promote" };

type Props = { params: Promise<{ id: string }> };

/**
 * Promote: a Verified feature that is not finished.
 *
 * <b>Nothing here submits anything.</b> There is no promotion table, no endpoint and no enquiry
 * form, and this page does not pretend otherwise — it says what the feature will be and that it is
 * not ready. That is the honest version of a screen in this state: a form that accepted an enquiry
 * nothing would read is worse than no form, because the owner would be waiting for an answer.
 *
 * It exists anyway, rather than waiting until it works, because it is listed in the nav as part of
 * the Verified plan. A feature somebody is being sold should be somewhere they can look at.
 *
 * The free listing sees the same page with a padlock and the upgrade prompt; the paid one sees
 * "coming soon". Both are true at once: it is included, and it is not built.
 */
export default async function ListingPromotePage({ params }: Props) {
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
        Promote
      </h1>
      <p className="mt-1 font-bold text-muted">{listing.name}</p>

      <ListingNav listingId={id} current="promote" verified={listing.verified} />

      <section className="mt-8 rounded-2xl border border-line bg-white px-6 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-black text-brand-800">Reach more customers near you</h2>
          <span className="rounded-full border border-line px-3 py-1 text-[11px] font-black tracking-[0.12em] text-muted uppercase">
            Under development
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          Promotion will let you put this listing in front of people searching your category and
          area &mdash; the places a customer looks first, rather than further down a list. You will
          be able to say what you want promoted and for how long, and see what it brought back.
        </p>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          It is not ready yet, and there is nothing to fill in on this page. When it opens, promotion
          enquiries will arrive here and we will tell you from your dashboard &mdash; you do not need
          to check back.
        </p>

        {!listing.verified ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm text-muted">
              Promote is part of the Verified listing. Upgrading now also unlocks photos, video, your
              logo and your own link names, which are ready to use today.
            </p>
            <div className="mt-3">
              {paidPlan ? (
                <UpgradeModal
                  listingId={id}
                  priceLabel={rupees(paidPlan.pricePaise)}
                  featureTitle="Promote"
                  featureBenefit="Put this listing in front of people searching your category and area. The feature is still being built; upgrading now unlocks photos, video, your logo and your own link names straight away."
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
