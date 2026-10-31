import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { EnquiryForm } from "@/components/EnquiryForm";
import { PageHero } from "@/components/PageHero";
import { ListingAttributes } from "@/components/ListingAttributes";
import { ListingContent, ListingFaqs } from "@/components/ListingFaqs";
import { OpeningHoursPanel } from "@/components/OpeningHoursPanel";
import { ReviewForm } from "@/components/ReviewForm";
import { Reviews } from "@/components/Reviews";
import { FavouriteButton } from "@/components/FavouriteButton";
import { JsonLd } from "@/components/JsonLd";
import { ListingGallery } from "@/components/ListingGallery";
import { ReportListing } from "@/components/ReportListing";
import { initialsOf } from "@/components/ui/BusinessCard";
import { getListing, getPageMeta, getReviews, withPageMeta } from "@/lib/api";
import { listFavourites } from "@/lib/owner-api";
import { readTokens } from "@/lib/session";
import { absoluteUrl, mapsHref, telHref, whatsappHref } from "@/lib/format";
import type { ListingDetail } from "@/lib/types";

type Props = { params: Promise<{ category: string; subcategory: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, subcategory, slug } = await params;
  const listing = await getListing(category, subcategory, slug);
  if (!listing) return { title: "Not found", robots: { index: false } };
  const title = `${listing.name} - ${listing.categoryName} in ${listing.localityName}, ${listing.cityName}`;
  const description =
    listing.description ??
    `${listing.name}, ${listing.categoryName} in ${listing.localityName}, ${listing.cityName}.`;

  /* The listing's own photo is the preview image where there is one. This is the page people share
     — into WhatsApp above all, which this site tells them to use to reach a business — and a card
     showing the shop beats one showing the directory's emblem. Falls back to the site default. */
  const photo = listing.media.find((item) => item.kind === "photo") ?? listing.media.find((item) => item.kind === "logo");

  // A staff-written override replaces whatever it sets, and leaves the rest as derived above.
  const override = await getPageMeta("listing", listing.slug);
  const applied = withPageMeta({ title, description }, override);

  return {
    ...applied,
    alternates: { canonical: absoluteUrl(listing.url) },
    openGraph: {
      type: "website",
      url: absoluteUrl(listing.url),
      title: applied.title,
      description: applied.description,
      ...(override?.ogImageUrl
        ? { images: [{ url: override.ogImageUrl, alt: listing.name }] }
        : photo
          ? { images: [{ url: photo.url, alt: listing.name }] }
          : {}),
    },
    twitter: {
      card: photo ? "summary_large_image" : "summary",
      title,
      description,
      ...(photo ? { images: [photo.url] } : {}),
    },
  };
}

/**
 * The facts panel.
 *
 * Only what the API actually returns is listed. The reference page also shows a rating, opening
 * hours, a services list, languages spoken, a contact person and social links; **none of those
 * have tables yet**, so they are left out rather than shown empty or invented. When those tables
 * exist, this is the function to extend.
 */
function factsFor(listing: ListingDetail): { label: string; value: React.ReactNode }[] {
  const facts: { label: string; value: React.ReactNode }[] = [];

  if (listing.addressLine) {
    facts.push({
      label: "Address",
      value: listing.pincode ? `${listing.addressLine} - ${listing.pincode}` : listing.addressLine,
    });
  }
  facts.push({ label: "Area", value: `${listing.localityName}, ${listing.cityName}` });
  facts.push({ label: "Category", value: listing.categoryName });
  facts.push({
    label: "Phone",
    value: (
      <a href={telHref(listing.phonePrimary)} className="text-brand-700 hover:underline">
        {listing.phonePrimary}
      </a>
    ),
  });
  if (listing.phoneWhatsapp) {
    facts.push({
      label: "WhatsApp",
      value: (
        <a
          href={whatsappHref(listing.phoneWhatsapp)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-700 hover:underline"
        >
          {listing.phoneWhatsapp}
        </a>
      ),
    });
  }
  if (listing.websiteUrl) {
    facts.push({
      label: "Website",
      value: (
        <a
          href={listing.websiteUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-brand-700 hover:underline"
        >
          Visit website <span aria-hidden="true">&#8599;</span>
        </a>
      ),
    });
  }
  return facts;
}

export default async function ListingPage({ params }: Props) {
  const { category, subcategory, slug } = await params;
  const listing = await getListing(category, subcategory, slug);
  if (!listing) notFound();

  /* The area is no longer in the URL, but reviews, enquiries and reports still address a listing
     by city + locality + slug on the API. Those come from the listing itself now rather than from
     the path, which is better anyway: they are what the database says, not what someone typed. */
  const city = listing.citySlug;
  const locality = listing.localitySlug;

  // Reviews are public, so they are fetched for everyone. Whether this visitor can *write* one
  // depends on a session cookie: readTokens() just reads it, unlike the owner helpers, which
  // redirect to sign-in when there is none - wrong behaviour on a public page.
  const [reviews, tokens] = await Promise.all([getReviews(city, locality, slug), readTokens()]);
  const signedIn = tokens.access !== null;

  // Whether this visitor has already saved it. Only asked when signed in: with no session the
  // owner helpers redirect to sign-in, which would be the wrong behaviour on a public page.
  let saved = false;
  if (signedIn) {
    const favourites = await listFavourites();
    saved = favourites.ok && favourites.data.some((item) => item.url === listing.url);
  }

  /* The URL must be the listing's canonical one, otherwise 301 to it (decision D4).

     Compared as a whole path, not segment by segment. This read `category !== listing.categorySlug`
     when the URL was /city/locality/category/slug, where `category` was the primary category. Under
     /parent/category/slug it is the *parent*, so it never equalled the subcategory and every
     listing page redirected to its own URL — a 308 loop, and the page never rendered.

     Comparing the whole path cannot do that: this only fires when the two genuinely differ, so the
     target is always somewhere else. */
  const canonicalPath = `/${category}/${subcategory}/${slug}`;
  if (listing.url !== canonicalPath) permanentRedirect(listing.url);

  const categoryPage = `/${category}/${subcategory}`;
  const facts = factsFor(listing);
  // An older listing has no media at all; a plan may also allow none. Both read as an empty list.
  const media = listing.media ?? [];
  const logo = media.find((item) => item.kind === "logo");
  const images = media.filter((item) => item.kind !== "video").map((item) => item.url);

  return (
    <>
      {/* The original's signature header: the trail and the business name inside a deep teal
          band, with everything else against white below it. The crumbs follow the segments of the
          URL, and every one is a page that exists. */}
      <PageHero
        crumbs={[
          { label: "Home", href: "/" },
          { label: listing.localityName, href: `/areas/${listing.localitySlug}` },
          { label: listing.categoryName, href: categoryPage },
          { label: listing.name },
        ]}
        title={listing.name}
        subtitle={`${listing.categoryName} in ${listing.localityName}, ${listing.cityName}`}
        aside={
          listing.isVerified ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/95 px-3.5 py-1.5 text-[13px] font-black text-amber-950">
              <span aria-hidden="true">&#10003;</span> Verified
            </span>
          ) : null
        }
      />

    <main className="mx-auto max-w-4xl px-5 py-10 pb-20 sm:px-8 lg:py-14 lg:pb-24">
      <article className="mt-8 rounded-2xl border border-line bg-white p-6 shadow-[0_12px_36px_#002a3410] sm:p-10 lg:p-12">
        {logo ? (
          <img
            src={logo.url}
            alt={`${listing.name} logo`}
            width={logo.width ?? undefined}
            height={logo.height ?? undefined}
            className="h-20 w-20 rounded-full border border-brand-200 bg-white object-contain"
          />
        ) : (
          // No logo uploaded: the initials stand in, as they do on the search cards.
          <div
            aria-hidden="true"
            className="grid h-20 w-20 place-items-center rounded-full border border-brand-200 bg-brand-50 text-2xl font-black text-brand-700"
          >
            {initialsOf(listing.name)}
          </div>
        )}

        <p className="mt-6 text-[11px] font-black tracking-[0.22em] text-muted">HYDERABAD BUSINESS DIRECTORY</p>
        <h1 className="mt-2 text-3xl leading-tight font-black tracking-tight text-brand-800 sm:text-4xl lg:text-5xl">
          {listing.name}
        </h1>
        <p className="mt-2 font-black text-brand-700">
          {listing.categoryName} &middot; {listing.localityName}
        </p>

        {/* The badge the Verified plan buys. `isVerified` is computed by the API from the
            subscription period against the clock, so this renders nothing the day a plan lapses
            without anything here having to know about subscriptions. */}
        {listing.isVerified ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-700 px-3.5 py-1.5 text-[11px] font-black tracking-[0.12em] text-white uppercase">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 1.5l2.1 1.6 2.6-.3 1 2.4 2.3 1.2-.6 2.6.6 2.6-2.3 1.2-1 2.4-2.6-.3L10 18.5l-2.1-1.6-2.6.3-1-2.4L2 13.6l.6-2.6L2 8.4l2.3-1.2 1-2.4 2.6.3L10 1.5zm3.7 6.2a.9.9 0 00-1.3-1.2l-3.2 3.4-1.6-1.5a.9.9 0 10-1.2 1.3l2.3 2.1a.9.9 0 001.3 0l3.7-4.1z"
                clipRule="evenodd"
              />
            </svg>
            Verified business
          </p>
        ) : null}

        {listing.description ? (
          <p className="mt-5 max-w-3xl text-base leading-[1.8] text-muted">{listing.description}</p>
        ) : null}

        <div className="mt-7 flex flex-wrap gap-3">
          <a
            href={telHref(listing.phonePrimary)}
            className="inline-flex items-center gap-2 rounded-full bg-brand-700 px-6 py-3 text-sm font-extrabold text-white hover:bg-brand-800"
          >
            Call {listing.phonePrimary}
          </a>
          {listing.phoneWhatsapp ? (
            <a
              href={whatsappHref(listing.phoneWhatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-6 py-3 text-sm font-extrabold text-brand-700 hover:border-brand-700 hover:bg-brand-50"
            >
              WhatsApp
            </a>
          ) : null}
          <a
            href={mapsHref(listing.latitude, listing.longitude)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-6 py-3 text-sm font-extrabold text-brand-700 hover:border-brand-700 hover:bg-brand-50"
          >
            Directions
          </a>
          <FavouriteButton
            city={city}
            locality={locality}
            slug={slug}
            saved={saved}
            signedIn={signedIn}
            signInHref={`/login?next=${encodeURIComponent(`/${category}/${subcategory}/${slug}`)}`}
          />
        </div>

        <dl className="mt-8 grid gap-3.5 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0 rounded-lg bg-brand-50 px-4 py-3.5">
              <dt className="text-[11px] font-black tracking-[0.12em] text-muted uppercase">{fact.label}</dt>
              <dd className="mt-1 font-bold break-words text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>

        {/* Website and social links, part of the Verified plan. The API sends an empty list for a
            free or lapsed listing rather than leaving it to this page to hide them, so there is no
            condition here beyond "are there any". rel="nofollow" because these are owner-supplied
            addresses and this directory does not vouch for them to a crawler. */}
        {listing.links.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-[11px] font-black tracking-[0.12em] text-muted uppercase">
              Find this business online
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2.5">
              {listing.links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center rounded-full border border-brand-200 bg-white px-4 py-2 text-sm font-extrabold text-brand-700 hover:border-brand-700 hover:bg-brand-50"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-6 text-xs text-muted">
          Business information is provided by the listing owner. Please confirm the details directly
          before making a purchase.
        </p>
      </article>

      <ListingGallery media={media} businessName={listing.name} />

      {/*
        Call and WhatsApp reach the owner immediately but leave no record. This form does: it
        becomes an enquiry in the owner's dashboard, so a missed call is not a lost customer.
      */}
      {/* Hours, the business's own description sections and its FAQs, before the enquiry form.
          Someone deciding whether to get in touch reads these first; putting them after the form
          would mean answering questions the visitor had already given up on. */}
      {listing.openingHours.length > 0 ||
      listing.contentSections.length > 0 ||
      listing.faqs.length > 0 ||
      listing.attributes.length > 0 ? (
        <div className="mt-10 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="grid gap-5">
            <ListingContent sections={listing.contentSections} />
            <ListingAttributes attributes={listing.attributes} />
            <ListingFaqs faqs={listing.faqs} businessName={listing.name} />
          </div>
          <OpeningHoursPanel hours={listing.openingHours} status={listing.openStatus} />
        </div>
      ) : null}

      <section
        id="enquiry"
        aria-labelledby="enquiry-heading"
        className="mt-10 rounded-2xl border border-line bg-white p-6 shadow-[0_8px_28px_#002a3412] sm:p-8"
      >
        <h2 id="enquiry-heading" className="text-xl font-black text-ink">
          Send {listing.name} a message
        </h2>
        <p className="mt-1 text-sm text-muted">
          They will see your number and can call or message you back. No account needed.
        </p>
        <div className="mt-5 max-w-xl">
          <EnquiryForm city={city} locality={locality} slug={slug} businessName={listing.name} />
        </div>
      </section>

      {/* Reviews sit after the enquiry form: someone who has read the details wants to contact the
          business, and what other people thought is what they check on the way out, not before. */}
      <Reviews
        summary={reviews}
        businessName={listing.name}
        signedIn={signedIn}
        writeHref={`/login?next=${encodeURIComponent(`/${category}/${subcategory}/${slug}`)}`}
      >
        <ReviewForm city={city} locality={locality} slug={slug} />
      </Reviews>

      <p className="mt-8 text-center text-sm text-muted">
        <Link href={categoryPage} className="font-bold text-brand-700 hover:underline">
          More {listing.categoryName.toLowerCase()} in {listing.localityName}
        </Link>
      </p>

      <ReportListing city={city} locality={locality} slug={slug} />

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: listing.name,
          description: listing.description ?? undefined,
          url: absoluteUrl(listing.url),
          telephone: listing.phonePrimary,
          address: {
            "@type": "PostalAddress",
            streetAddress: listing.addressLine ?? undefined,
            addressLocality: listing.localityName,
            addressRegion: "Telangana",
            postalCode: listing.pincode ?? undefined,
            addressCountry: "IN",
          },
          geo: { "@type": "GeoCoordinates", latitude: listing.latitude, longitude: listing.longitude },
          // Search engines show these next to the result. Only real uploaded files are listed, and
          // the property is left out altogether when the business has none.
          image: images.length > 0 ? images : undefined,
        }}
      />
    </main>
    </>
  );
}
