import { ListingNav } from "@/components/account/ListingNav";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddLinkForm } from "@/components/account/AddLinkForm";
import { RemoveLinkButton } from "@/components/account/RemoveLinkButton";
import { RenameLinkForm } from "@/components/account/RenameLinkForm";
import { UpgradeModal } from "@/components/account/UpgradeModal";
import { LockIcon } from "@/components/account/VerifiedFeatures";
import { EmptyState } from "@/components/ui/EmptyState";
import { rupees } from "@/lib/format";
import { getListingLinks, getListingSubscription, getMyListing } from "@/lib/owner-api";
import { LINK_TYPES } from "./form-state";

export const metadata: Metadata = { title: "Website and social links" };

type Props = { params: Promise<{ id: string }> };

const typeLabel = (value: string) =>
  LINK_TYPES.find((type) => type.value === value)?.label ?? value;

/** The date an owner reads, not an ISO string. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * The owner's website and social links for one listing.
 *
 * <b>Links are free and unlimited (S0029).</b> Every listing may add as many as it likes; what the
 * Verified plan buys is naming them, so a free listing's links are `Link 1`, `Link 2`, ... and a
 * paid one's are the owner's own words. The upsell is therefore on the names, not on the links, and
 * nothing on this screen is locked shut.
 *
 * `canNameLinks` and `paidUntil` both come from the API, which derives them from the subscription
 * period against the clock. That is why this page never decides anything about expiry itself: a
 * lapsed listing arrives with `canNameLinks: false` and keeps every link it already saved.
 */
export default async function ListingLinksPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  /* The plan comes along for the price on the naming upsell -- the same figure the Plan and
     payment screen quotes, read from the same `plans` row. */
  const [listingResult, linksResult, subscriptionResult] = await Promise.all([
    getMyListing(id),
    getListingLinks(id),
    getListingSubscription(id),
  ]);
  if (!listingResult.ok || !linksResult.ok) {
    const failed = !listingResult.ok ? listingResult : linksResult;
    if (failed.ok === false && failed.status === 404) notFound();   // also what another owner's listing looks like
    return (
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <EmptyState tone="error" mark="&#9888;" title="We could not load your links">
          <p>{failed.ok === false ? failed.message : ""}</p>
        </EmptyState>
      </main>
    );
  }

  const listing = listingResult.data;
  const { allowance, items } = linksResult.data;
  const plan = subscriptionResult.ok ? subscriptionResult.data : null;
  const paidPlan = plan?.paidPlan ?? null;

  /* Both read with a fallback, because the websites and the API deploy independently: against an
     API from before S0029 neither field is sent, and the honest reading of its absence is "there
     is still a cap" and "naming follows the badge" — which is exactly what that API did. */
  const unlimited = allowance.unlimited ?? false;
  const canNameLinks = allowance.canNameLinks ?? allowance.verified;
  const full = !unlimited && allowance.used >= allowance.limit;

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <p className="text-[11px] font-black tracking-[0.22em] text-muted uppercase">Listing</p>
      <h1 className="mt-1 text-2xl font-black tracking-tight text-brand-800 sm:text-3xl">
        Website and social links
      </h1>
      <p className="mt-1 font-bold text-muted">{listing.name}</p>

      <ListingNav listingId={id} current="links" verified={listing.verified} />

      <section className="mt-8 rounded-xl bg-brand-50 px-5 py-4">
        <p className="text-sm font-black text-brand-800">
          {allowance.planName} plan &middot; {allowance.used}{" "}
          {allowance.used === 1 ? "link" : "links"} &middot; add as many as you like
        </p>

        {!canNameLinks ? (
          /* A div, not a p: `UpgradeModal` renders a <dialog>, which is flow content and cannot
             legally sit inside a paragraph — the browser's parser closes the <p> before it, which
             gives React a tree the server did not render and a hydration mismatch. */
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
            <LockIcon className="size-3.5 shrink-0" />
            <span>
              Your links are named <span className="font-bold text-ink">Link 1</span>,{" "}
              <span className="font-bold text-ink">Link 2</span> and so on.
            </span>
            {paidPlan ? (
              <UpgradeModal
                listingId={id}
                priceLabel={rupees(paidPlan.pricePaise)}
                featureTitle="Make your own field"
                featureBenefit="Name each link yourself — “Our menu”, “Book a table”, “Price list” — instead of Link 1, Link 2. A customer reads the name before they decide to tap."
                paymentsLive={plan?.paymentsAvailable ?? false}
                trigger={
                  <button type="button" className="cursor-pointer font-bold text-brand-700 hover:underline">
                    Name them yourself with Verified
                  </button>
                }
              />
            ) : (
              <Link href={`/account/listings/${id}/subscription`} className="font-bold text-brand-700 hover:underline">
                See the plan
              </Link>
            )}
            {allowance.planSlug === "free" && allowance.paidUntil ? (
              <span>
                This listing&rsquo;s Verified plan ended on {formatDate(allowance.paidUntil)}. The
                names you had chosen are still saved and are published again on renewal; until then
                visitors see the numbers.
              </span>
            ) : null}
          </div>
        ) : allowance.paidUntil ? (
          <p className="mt-1 text-sm text-muted">
            Verified until {formatDate(allowance.paidUntil)}. Your own link names stop applying
            after that date, and are kept so renewing brings them back.
          </p>
        ) : null}
      </section>

      {items.length > 0 ? (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-white">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-black tracking-[0.12em] text-muted uppercase">
                  {typeLabel(item.linkType)}
                </p>
                {/* What a visitor sees. On a paid listing that is the owner's own name; on a
                    free or lapsed one it is the position, and the saved name is shown underneath so
                    the owner can see it has not been lost. `displayLabel` is absent against an API
                    from before S0029, where the stored label was what got published. */}
                <p className="font-bold text-ink">{item.displayLabel ?? item.label}</p>
                {!canNameLinks && item.label !== (item.displayLabel ?? item.label) ? (
                  <p className="text-xs text-muted">
                    Your name for it, saved: <span className="font-bold">{item.label}</span>
                  </p>
                ) : null}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-sm break-all text-brand-700 hover:underline"
                >
                  {item.url}
                </a>
              </div>
              {/* Its own line on a phone, beside the link from `sm` up. `shrink-0` on a row that
                  can hold an open rename field is what pushed the page sideways at 375px: the group
                  refused to shrink and there was nowhere for it to go. */}
              <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto sm:flex-nowrap">
                {canNameLinks ? (
                  <RenameLinkForm listingId={id} linkId={item.id} label={item.label} />
                ) : null}
                <RemoveLinkButton listingId={id} linkId={item.id} label={item.displayLabel ?? item.label} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-muted">No links yet.</p>
      )}

      <section className="mt-9">
        <h2 className="text-lg font-black text-brand-800">Add a link</h2>
        {full ? (
          <p className="mt-2 text-sm text-muted">
            All {allowance.limit} links are used. Remove one to add another.
          </p>
        ) : (
          <AddLinkForm
            listingId={id}
            canNameLinks={canNameLinks}
            /* The number the next link will actually be called, not a placeholder: the list is
               numbered by position, so the next one is one past what is there. */
            nextNumber={allowance.used + 1}
          />
        )}
      </section>
    </main>
  );
}
