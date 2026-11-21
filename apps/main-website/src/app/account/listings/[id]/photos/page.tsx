import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingNav } from "@/components/account/ListingNav";
import { MediaUploader } from "@/components/account/MediaUploader";
import { MoveMediaButton } from "@/components/account/MoveMediaButton";
import { RemoveMediaButton } from "@/components/account/RemoveMediaButton";
import { VerifiedFeatures } from "@/components/account/VerifiedFeatures";
import { EmptyState } from "@/components/ui/EmptyState";
import { rupees } from "@/lib/format";
import {
  getListingMedia,
  getListingSubscription,
  getMyListing,
  type ListingMediaItem,
} from "@/lib/owner-api";

export const metadata: Metadata = { title: "Photos and video" };

type Props = { params: Promise<{ id: string }> };

/**
 * The owner's photos, logo and video for one listing.
 *
 * Plain <img> and <video> rather than next/image: these files live in Blob Storage under a host that
 * differs per environment, and the optimiser would need that host registered in next.config for each
 * one. The sizes are small and already capped by the API.
 */
export default async function ListingPhotosPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  /* The plan comes along because a free listing is shown what Verified would unlock, at the price
     the database holds. It is the same call the Plan and payment screen makes, so the figure on
     this screen cannot disagree with the one on that one. */
  const [listingResult, mediaResult, subscriptionResult] = await Promise.all([
    getMyListing(id),
    getListingMedia(id),
    getListingSubscription(id),
  ]);
  if (!listingResult.ok || !mediaResult.ok) {
    const failed = !listingResult.ok ? listingResult : mediaResult;
    if (failed.ok === false && failed.status === 404) notFound();   // also what another owner's listing looks like
    return (
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <EmptyState tone="error" mark="&#9888;" title="We could not load your photos">
          <p>{failed.ok === false ? failed.message : ""}</p>
        </EmptyState>
      </main>
    );
  }

  const listing = listingResult.data;
  const { allowance, items } = mediaResult.data;
  const plan = subscriptionResult.ok ? subscriptionResult.data : null;
  const paidPlan = plan?.paidPlan ?? null;
  const of = (kind: ListingMediaItem["kind"]) => items.filter((item) => item.kind === kind);

  const sections = [
    {
      kind: "logo" as const,
      title: "Logo",
      blurb: "Your shop or brand mark. Shown beside the business name.",
      used: allowance.logosUsed,
      limit: allowance.logoLimit,
      accept: "image/jpeg,image/png,image/webp",
      maxLabel: "JPEG, PNG or WebP, up to 8 MB.",
    },
    {
      kind: "photo" as const,
      title: "Photos",
      blurb: "Pictures of the place, the work or the products.",
      used: allowance.photosUsed,
      limit: allowance.photoLimit,
      accept: "image/jpeg,image/png,image/webp",
      maxLabel: "JPEG, PNG or WebP, up to 8 MB each.",
    },
    {
      kind: "video" as const,
      title: "Video",
      blurb: "A short clip. MP4 only.",
      used: allowance.videosUsed,
      limit: allowance.videoLimit,
      accept: "video/mp4",
      maxLabel: "MP4, up to 64 MB.",
    },
  ];

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <Link href={`/account/listings/${id}/edit`} className="text-sm font-bold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> Back to {listing.name}
      </Link>

      <div className="mt-4 border-b border-line pb-5">
        <p className="text-[11px] font-black tracking-[0.22em] text-muted">PHOTOS AND VIDEO</p>
        <h1 className="mt-1 text-3xl leading-tight font-black tracking-tight text-brand-800">{listing.name}</h1>
        <p className="mt-2 text-muted">
          How much you can add depends on your plan. This listing is on <span className="font-bold text-ink">{allowance.planName}</span>.
        </p>
        <ListingNav listingId={id} current="photos" verified={listing.verified} />
      </div>

      {!listing.verified ? (
        /* Every allowance is zero on the Free plan, so the upload boxes below could only ever
           refuse. The screen is still reachable -- it is listed in the nav with a padlock rather
           than hidden -- and what it shows is each locked feature, what it would be worth, and the
           price. Anything uploaded under an earlier paid plan is still stored and comes back on
           renewal (D10), which is why this says kept.

           The numbers come from `paidPlan`, which is the `plans` row, so this cannot promise an
           allowance the API would then refuse to grant. */
        <div className="mt-8 rounded-2xl border border-line bg-white px-6 py-5">
          <h2 className="text-lg font-black text-brand-800">
            Photos, video and your logo come with Verified
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            This listing is on <span className="font-bold text-ink">{allowance.planName}</span>.
            Anything you added on an earlier plan is kept and comes back the moment the listing is
            Verified again &mdash; nothing is deleted.
          </p>

          {paidPlan ? (
            <div className="mt-4 border-t border-line pt-2">
              <VerifiedFeatures
                listingId={id}
                verified={false}
                priceLabel={rupees(paidPlan.pricePaise)}
                paymentsLive={plan?.paymentsAvailable ?? false}
                features={[
                  {
                    title: "Photos",
                    benefit: `Up to ${paidPlan.photoLimit} pictures of the place, the work or the products.`,
                    usage: null,
                  },
                  {
                    title: "Video",
                    benefit: `${paidPlan.videoLimit === 1 ? "A short clip" : `Up to ${paidPlan.videoLimit} short clips`} on your listing page.`,
                    usage: null,
                  },
                  {
                    title: "Business logo",
                    benefit: "Your shop or brand mark beside the business name, everywhere you appear.",
                    usage: null,
                  },
                ]}
              />
            </div>
          ) : (
            <Link
              href={`/account/listings/${id}/subscription`}
              className="mt-4 inline-block rounded-full bg-brand-700 px-5 py-2 text-sm font-black text-white hover:bg-brand-800"
            >
              See plans and prices
            </Link>
          )}
        </div>
      ) : (
        <>

      {!allowance.limitsConfirmed ? (
        // Never present a provisional number as settled: the API says whether it has been confirmed.
        <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          These allowances are not final yet. They may change before the paid plans go on sale.
        </p>
      ) : null}

      {!allowance.uploadsAvailable ? (
        <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Uploads are temporarily unavailable. Anything already added is safe and still shown.
        </p>
      ) : null}

      {sections.map((section) => {
        const own = of(section.kind);
        const remaining = section.limit - section.used;
        return (
          <section key={section.kind} className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-black text-brand-800">{section.title}</h2>
              {/* `3 / 5` rather than "3 of 5 used": it is a figure an owner checks at a glance
                  while adding files, and the shorter form reads as one. */}
              <p className="text-sm font-bold text-muted">
                {section.limit === 0 ? (
                  "Not included in this plan"
                ) : (
                  <>
                    <span className={section.used >= section.limit ? "text-ink" : "text-brand-700"}>
                      {section.used}
                    </span>
                    {" / "}
                    {section.limit}
                  </>
                )}
              </p>
            </div>
            <p className="mt-1 text-sm text-muted">{section.blurb}</p>

            {own.length > 0 ? (
              <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {own.map((item, index) => (
                  <li key={item.id} className="rounded-xl border border-line bg-white p-3">
                    {item.kind === "video" ? (
                      <video src={item.url} controls preload="metadata" className="aspect-video w-full rounded-lg bg-black" />
                    ) : (
                      <img
                        src={item.url}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full rounded-lg bg-surface object-cover"
                      />
                    )}
                    {item.isHidden ? (
                      <p className="mt-2 text-xs font-bold text-amber-700">
                        Hidden &mdash; over what your current plan allows.
                      </p>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <RemoveMediaButton listingId={id} mediaId={item.id} what={section.kind} />
                      {/* Order is only worth changing when there is more than one of a kind. */}
                      {own.length > 1 ? (
                        <span className="flex gap-1">
                          <MoveMediaButton listingId={id} mediaId={item.id} direction="up" disabled={index === 0} />
                          <MoveMediaButton
                            listingId={id}
                            mediaId={item.id}
                            direction="down"
                            disabled={index === own.length - 1}
                          />
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {section.limit === 0 ? (
              <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
                The {allowance.planName} plan does not include {section.title.toLowerCase()}.
              </p>
            ) : remaining <= 0 ? (
              <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
                You have used all {section.limit} on this plan. Remove one to add another.
              </p>
            ) : allowance.uploadsAvailable ? (
              <MediaUploader
                listingId={id}
                kind={section.kind}
                label={`Add ${section.kind === "photo" ? "a photo" : section.kind === "logo" ? "your logo" : "a video"}`}
                accept={section.accept}
                maxLabel={section.maxLabel}
              />
            ) : null}
          </section>
        );
      })}
        </>
      )}
    </main>
  );
}
