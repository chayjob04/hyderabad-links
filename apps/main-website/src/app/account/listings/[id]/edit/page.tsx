import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingNav } from "@/components/account/ListingNav";
import { ListingSection } from "@/components/account/ListingSection";
import { MediaUploader } from "@/components/account/MediaUploader";
import { MoveMediaButton } from "@/components/account/MoveMediaButton";
import { RemoveMediaButton } from "@/components/account/RemoveMediaButton";
import { AddLinkForm } from "@/components/account/AddLinkForm";
import { RemoveLinkButton } from "@/components/account/RemoveLinkButton";
import { RenameLinkForm } from "@/components/account/RenameLinkForm";
import { LockIcon } from "@/components/account/VerifiedFeatures";
import { ListingForm } from "@/components/ListingForm";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCategories } from "@/lib/api";
import {
  describeStatus,
  getListingAttributes,
  getListingContent,
  getListingFaqs,
  getListingLinks,
  getListingMedia,
  getMyListing,
  getOpeningHours,
} from "@/lib/owner-api";
import { completionOf, filled, filledTo, overallCompletion } from "@/lib/listing-completion";
import { saveListingAction } from "../../../actions";
import { HoursForm } from "../hours/HoursForm";
import { AddContentForm, AddFaqForm } from "../about/AddForms";
import { AttributeForm } from "../about/AttributeForm";

export const metadata: Metadata = { title: "Edit listing" };

type Props = { params: Promise<{ id: string }> };

/** The three kinds of media, exactly as the photos screen described them. */
const MEDIA_KINDS = [
  {
    kind: "logo" as const,
    title: "Logo",
    blurb: "Your shop or brand mark. Shown beside the business name.",
    accept: "image/jpeg,image/png,image/webp",
    maxLabel: "JPEG, PNG or WebP, up to 8 MB.",
  },
  {
    kind: "photo" as const,
    title: "Photos",
    blurb: "Pictures of the place, the work or the products.",
    accept: "image/jpeg,image/png,image/webp",
    maxLabel: "JPEG, PNG or WebP, up to 8 MB each.",
  },
  {
    kind: "video" as const,
    title: "Video",
    blurb: "A short clip. MP4 only.",
    accept: "video/mp4",
    maxLabel: "MP4, up to 64 MB.",
  },
];

/** The three kinds of amenity the about screen asks for, in the order it asked for them. */
const ATTRIBUTE_KINDS = [
  { kind: "offering", placeholder: "Filter coffee" },
  { kind: "language", placeholder: "Telugu" },
  { kind: "amenity", placeholder: "Wi-Fi" },
] as const;

/**
 * Everything about one listing, on one screen.
 *
 * This replaces nine separate screens -- edit, preview, photos, hours, about, links, promote, ads
 * and plan -- reached through a row of links that an owner had to work their way along to find out
 * what was still empty. The business information is now a set of collapsible sections, each saying
 * how much of itself is filled in, and the two subscription screens stay where they were: a plan is
 * not a field on a form.
 *
 * <b>The forms are the same forms.</b> `ListingForm`, `HoursForm`, `AddFaqForm`, `AddContentForm`,
 * `AttributeForm`, `MediaUploader`, `AddLinkForm` and the per-item buttons are imported from where
 * they already lived, with the server actions they already posted to. Nothing about saving changed
 * except that the business-details form now has two buttons instead of one.
 *
 * The old section screens redirect here, so a bookmark still works and there is one place to edit
 * each thing rather than two that could drift apart.
 */
export default async function EditListingPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  /* One round of requests for the whole screen. Each section used to fetch its own on a page of
     its own; gathering them here is what lets a heading say "40%" before it is opened. */
  const [result, categories, hours, faqs, content, attributes, links, media] = await Promise.all([
    getMyListing(id),
    getCategories(),
    getOpeningHours(id),
    getListingFaqs(id),
    getListingContent(id),
    getListingAttributes(id),
    getListingLinks(id),
    getListingMedia(id),
  ]);

  if (!result.ok) {
    if (result.status === 404) notFound(); // also what another owner's listing looks like
    return (
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <EmptyState tone="error" mark="&#9888;" title="We could not load this listing">
          <p>{result.message}</p>
        </EmptyState>
      </main>
    );
  }

  const listing = result.data;
  const verified = listing.verified;

  // ---------------------------------------------------------------- what is filled in
  /* Counted from the values the API returned, never from a constant. The two fields a reviewer
     needs -- an address and a description of at least 20 characters -- are the same two
     `ListingReadiness` gates Submit on, so this section reading 100% and Submit being accepted are
     the same statement. */
  const detailsCompletion = completionOf([
    { label: "business name", done: filled(listing.name) },
    { label: "category", done: filled(listing.categorySlug) },
    { label: "area", done: filled(listing.localityName) },
    { label: "address", done: filled(listing.addressLine) },
    { label: "phone number", done: filled(listing.phonePrimary) },
    { label: "a description of at least 20 characters", done: filledTo(listing.description, 20) },
    { label: "pincode", done: filled(listing.pincode), optional: true },
    { label: "WhatsApp number", done: filled(listing.phoneWhatsapp), optional: true },
    { label: "website", done: filled(listing.websiteUrl), optional: true },
  ]);

  const photos = media.ok ? media.data.items.filter((item) => item.kind === "photo") : [];
  const videos = media.ok ? media.data.items.filter((item) => item.kind === "video") : [];
  const logos = media.ok ? media.data.items.filter((item) => item.kind === "logo") : [];
  /* Nothing is required of a plan that does not include media, so the section reads 100% rather
     than holding the listing at an incompleteness the owner cannot act on without paying. */
  const photosCompletion = completionOf(
    verified
      ? [
          { label: "at least one photo", done: photos.length > 0 },
          { label: "a logo", done: logos.length > 0, optional: true },
          { label: "a video", done: videos.length > 0, optional: true },
        ]
      : [],
  );

  const intervals = hours.ok ? hours.data.intervals : [];
  const hoursCompletion = completionOf([
    { label: "opening hours for at least one day", done: intervals.length > 0 },
  ]);

  const aboutCompletion = completionOf([
    { label: "at least one question and answer", done: faqs.ok && faqs.data.items.length > 0 },
    { label: "a paragraph about the business", done: content.ok && content.data.items.length > 0 },
    {
      label: "what you offer, speak or provide",
      done: attributes.ok && attributes.data.items.length > 0,
    },
  ]);

  const linkItems = links.ok ? links.data.items : [];
  const linksCompletion = completionOf([
    { label: "a website or social link", done: linkItems.length > 0 },
  ]);

  const overall = overallCompletion([
    detailsCompletion,
    photosCompletion,
    hoursCompletion,
    aboutCompletion,
    linksCompletion,
  ]);

  /* The first section with something outstanding opens itself, so a half-built listing shows the
     gap rather than a column of closed headings. A finished one opens nothing. */
  const firstIncomplete = [
    detailsCompletion.percent < 100 ? "details" : null,
    photosCompletion.percent < 100 ? "photos" : null,
    hoursCompletion.percent < 100 ? "hours" : null,
    aboutCompletion.percent < 100 ? "about" : null,
    linksCompletion.percent < 100 ? "links" : null,
  ].find(Boolean);

  const canNameLinks = links.ok ? (links.data.allowance.canNameLinks ?? links.data.allowance.verified) : false;
  const linksUsed = links.ok ? links.data.allowance.used : 0;

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <Link href="/account/listings" className="text-sm font-bold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> Back to my listings
      </Link>

      <div className="mt-4 border-b border-line pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black tracking-[0.22em] text-muted">
              {listing.categoryName.toUpperCase()} &middot; {listing.localityName.toUpperCase()}
            </p>
            <h1 className="mt-1 text-3xl leading-tight font-black tracking-tight text-brand-800">
              {listing.name}
            </h1>
          </div>
          <StatusBadge status={listing.status} />
        </div>
        <p className="mt-2 text-muted">{describeStatus(listing.status).help}</p>

        {/* The whole listing, from the same section figures shown below, so the two can never
            disagree. */}
        <p className="mt-3 text-sm font-black text-brand-700">
          {overall.percent}% complete
          {overall.missing.length > 0 ? (
            <span className="font-bold text-muted"> &middot; {overall.missing.length} still to add</span>
          ) : null}
        </p>

        <ListingNav listingId={listing.id} current="edit" verified={verified} />

        {listing.status === "active" ? (
          <p className="mt-2">
            <Link href={listing.url} className="text-sm font-black text-brand-700 hover:underline">
              View public page <span aria-hidden="true">&rarr;</span>
            </Link>
          </p>
        ) : null}
      </div>

      {listing.status === "rejected" && listing.reviewNote ? (
        <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-black">What to change:</span> {listing.reviewNote}
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {/* ---------------------------------------------------------------- business details */}
        <ListingSection
          title="Business details"
          blurb="The name, where you are, how to reach you, and what you do. An address and a description are what we need before we can review it."
          completion={detailsCompletion}
          defaultOpen={firstIncomplete === "details" || firstIncomplete === undefined}
        >
          <ListingForm
            action={saveListingAction.bind(null, listing.id)}
            categories={categories}
            lockedLocalityName={listing.localityName}
            initialValues={{
              name: listing.name,
              categorySlug: listing.categorySlug,
              addressLine: listing.addressLine ?? "",
              pincode: listing.pincode ?? "",
              phonePrimary: listing.phonePrimary,
              phoneWhatsapp: listing.phoneWhatsapp ?? "",
              websiteUrl: listing.websiteUrl ?? "",
              description: listing.description ?? "",
            }}
            submitLabel="Save changes"
            submitAction="Submit for review"
          />
        </ListingSection>

        {/* ---------------------------------------------------------------- photos and video */}
        <ListingSection
          title="Photos and video"
          blurb={
            verified
              ? "The first photo is the one visitors see on the search results."
              : undefined
          }
          completion={photosCompletion}
          defaultOpen={firstIncomplete === "photos"}
          locked={!verified}
          badge={verified ? undefined : "Verified plan"}
        >
          {!verified ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
              <LockIcon className="size-3.5 shrink-0" />
              <span>
                Photos and video are part of the Verified plan.{" "}
                <Link
                  href={`/account/listings/${id}/subscription`}
                  className="font-black text-brand-700 hover:underline"
                >
                  See the plan
                </Link>
                .
              </span>
            </p>
          ) : !media.ok ? (
            <EmptyState tone="error" mark="&#9888;" title="We could not load your photos">
              <p>{media.message}</p>
            </EmptyState>
          ) : (
            <div className="space-y-8">
              <p className="text-sm text-muted">
                How much you can add depends on your plan. This listing is on{" "}
                <span className="font-bold text-ink">{media.data.allowance.planName}</span>.
              </p>

              {MEDIA_KINDS.map((section) => {
                const own = media.data.items.filter((item) => item.kind === section.kind);
                const limit =
                  section.kind === "logo"
                    ? media.data.allowance.logoLimit
                    : section.kind === "photo"
                      ? media.data.allowance.photoLimit
                      : media.data.allowance.videoLimit;
                const used = own.length;

                return (
                  <section key={section.kind}>
                    <h3 className="font-black text-brand-800">
                      {section.title}{" "}
                      <span className="text-sm font-bold text-muted">
                        {used} of {limit}
                      </span>
                    </h3>
                    <p className="mt-1 text-sm text-muted">{section.blurb}</p>

                    {own.length > 0 ? (
                      <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                        {own.map((item, index) => (
                          <li key={item.id} className="rounded-lg border border-line p-2">
                            {section.kind === "video" ? (
                              <video src={item.url} controls className="w-full rounded" />
                            ) : (
                              /* eslint-disable-next-line @next/next/no-img-element -- an owner upload of unknown size */
                              <img src={item.url} alt="" className="aspect-square w-full rounded object-cover" />
                            )}
                            {item.isHidden ? (
                              <p className="mt-2 text-xs text-muted">
                                Kept, but over your plan&apos;s allowance, so it is not shown publicly.
                              </p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <RemoveMediaButton listingId={id} mediaId={item.id} what={section.kind} />
                              {/* Order is only worth changing when there is more than one of a kind. */}
                              {own.length > 1 ? (
                                <span className="flex gap-1">
                                  <MoveMediaButton
                                    listingId={id}
                                    mediaId={item.id}
                                    direction="up"
                                    disabled={index === 0}
                                  />
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

                    {used < limit ? (
                      <div className="mt-3">
                        <MediaUploader
                          listingId={id}
                          kind={section.kind}
                          label={`Add ${
                            section.kind === "photo" ? "a photo" : section.kind === "logo" ? "your logo" : "a video"
                          }`}
                          accept={section.accept}
                          maxLabel={section.maxLabel}
                        />
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-muted">
                        All {limit} used. Remove one to add another.
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </ListingSection>

        {/* ---------------------------------------------------------------- opening hours */}
        <ListingSection
          title="Opening hours"
          blurb="Your listing shows Open now or Closed from these, in Hyderabad time. Available on every plan."
          completion={hoursCompletion}
          defaultOpen={firstIncomplete === "hours"}
        >
          {hours.ok ? (
            <HoursForm listingId={id} initial={hours.data.intervals} />
          ) : (
            <EmptyState tone="error" mark="&#9888;" title="We could not load your hours">
              <p>{hours.message}</p>
            </EmptyState>
          )}
        </ListingSection>

        {/* ---------------------------------------------------------------- about, FAQs, amenities */}
        <ListingSection
          title="About, questions and amenities"
          blurb="What you offer, the questions people ask, and a paragraph or two in your own words."
          completion={aboutCompletion}
          defaultOpen={firstIncomplete === "about"}
        >
          {attributes.ok ? (
            <div className="space-y-6">
              {ATTRIBUTE_KINDS.map((section) => (
                <AttributeForm
                  key={section.kind}
                  listingId={id}
                  kind={section.kind}
                  heading={attributes.data.kinds[section.kind] ?? section.kind}
                  placeholder={section.placeholder}
                  suggestions={attributes.data.suggestions[section.kind] ?? []}
                  existing={attributes.data.items.filter((a) => a.kind === section.kind).map((a) => a.label)}
                  used={attributes.data.items.filter((a) => a.kind === section.kind).length}
                  max={attributes.data.maxPerKind}
                />
              ))}
            </div>
          ) : null}

          {faqs.ok ? (
            <div className="mt-8 border-t border-line pt-6">
              {faqs.data.items.length > 0 ? (
                <ul className="mb-4 space-y-3">
                  {faqs.data.items.map((faq) => (
                    <li key={faq.id} className="rounded-lg border border-line px-4 py-3">
                      <p className="font-black text-ink">{faq.question}</p>
                      <p className="mt-1 text-sm whitespace-pre-line text-muted">{faq.answer}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <AddFaqForm
                listingId={id}
                limit={faqs.data.limit}
                used={faqs.data.used}
                planName={faqs.data.planName}
              />
            </div>
          ) : null}

          {content.ok ? (
            <div className="mt-8 border-t border-line pt-6">
              {content.data.items.length > 0 ? (
                <ul className="mb-4 space-y-3">
                  {content.data.items.map((section, index) => (
                    <li key={section.id} className="rounded-lg border border-line px-4 py-3">
                      <p className="font-black text-ink">{section.heading}</p>
                      <p className="mt-1 text-sm whitespace-pre-line text-muted">{section.body}</p>
                      {index >= content.data.limit ? (
                        <p className="mt-2 text-xs text-muted">
                          Over your plan&apos;s allowance, so this one is not shown publicly. It is kept.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <AddContentForm
                listingId={id}
                limit={content.data.limit}
                used={content.data.used}
                planName={content.data.planName}
              />
            </div>
          ) : null}
        </ListingSection>

        {/* ---------------------------------------------------------------- links */}
        <ListingSection
          title="Website and social links"
          blurb="Add as many as you like, on any plan. Naming them is part of the Verified plan; otherwise they are Link 1, Link 2 and so on."
          completion={linksCompletion}
          defaultOpen={firstIncomplete === "links"}
        >
          {!links.ok ? (
            <EmptyState tone="error" mark="&#9888;" title="We could not load your links">
              <p>{links.message}</p>
            </EmptyState>
          ) : (
            <>
              {linkItems.length > 0 ? (
                <ul className="mb-5 divide-y divide-line rounded-lg border border-line">
                  {linkItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-black text-ink">{item.displayLabel ?? item.label}</p>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-sm break-all text-brand-700 hover:underline"
                        >
                          {item.url}
                        </a>
                      </div>
                      <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto sm:flex-nowrap">
                        {canNameLinks ? (
                          <RenameLinkForm listingId={id} linkId={item.id} label={item.label} />
                        ) : null}
                        <RemoveLinkButton
                          listingId={id}
                          linkId={item.id}
                          label={item.displayLabel ?? item.label}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-5 text-sm text-muted">No links yet.</p>
              )}

              <AddLinkForm listingId={id} canNameLinks={canNameLinks} nextNumber={linksUsed + 1} />
            </>
          )}
        </ListingSection>
      </div>
    </main>
  );
}
