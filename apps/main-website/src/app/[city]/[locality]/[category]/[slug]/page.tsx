import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { EnquiryForm } from "@/components/EnquiryForm";
import { ReviewForm } from "@/components/ReviewForm";
import { Reviews } from "@/components/Reviews";
import { FavouriteButton } from "@/components/FavouriteButton";
import { JsonLd } from "@/components/JsonLd";
import { ListingGallery } from "@/components/ListingGallery";
import { ReportListing } from "@/components/ReportListing";
import { initialsOf } from "@/components/ui/BusinessCard";
import { getListing, getReviews } from "@/lib/api";
import { listFavourites } from "@/lib/owner-api";
import { readTokens } from "@/lib/session";
import { absoluteUrl, mapsHref, telHref, whatsappHref } from "@/lib/format";
import type { ListingDetail } from "@/lib/types";

type Props = { params: Promise<{ city: string; locality: string; category: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city, locality, slug } = await params;
  const listing = await getListing(city, locality, slug);
  if (!listing) return { title: "Not found", robots: { index: false } };
  return {
    title: `${listing.name} - ${listing.categoryName} in ${listing.localityName}, ${listing.cityName}`,
    description:
      listing.description ??
      `${listing.name}, ${listing.categoryName} in ${listing.localityName}, ${listing.cityName}.`,
    alternates: { canonical: absoluteUrl(listing.url) },
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
  const { city, locality, category, slug } = await params;
  const listing = await getListing(city, locality, slug);
  if (!listing) notFound();

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

  // The category in the URL must be the listing's primary category, otherwise 301 to the canonical URL (decision D4).
  if (category !== listing.categorySlug) permanentRedirect(listing.url);

  const categoryPage = `/${listing.citySlug}/${listing.localitySlug}/${listing.categorySlug}`;
  const facts = factsFor(listing);
  // An older listing has no media at all; a plan may also allow none. Both read as an empty list.
  const media = listing.media ?? [];
  const logo = media.find((item) => item.kind === "logo");
  const images = media.filter((item) => item.kind !== "video").map((item) => item.url);

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      {/*
        The crumbs follow the segments of the URL this page is at - city/locality/category/slug -
        and every one of them is a page that exists: the area and the category resolve through
        search, and the third crumb is the locality + category page itself.
      */}
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <li>
            <Link href="/" className="font-bold text-brand-700 hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden="true">&rsaquo;</li>
          <li>
            <Link href={`/search?locality=${listing.localitySlug}`} className="font-bold text-brand-700 hover:underline">
              {listing.localityName}
            </Link>
          </li>
          <li aria-hidden="true">&rsaquo;</li>
          <li>
            <Link href={categoryPage} className="font-bold text-brand-700 hover:underline">
              {listing.categoryName}
            </Link>
          </li>
          <li aria-hidden="true">&rsaquo;</li>
          <li aria-current="page" className="min-w-0 truncate">
            {listing.name}
          </li>
        </ol>
      </nav>

      <article className="mt-6 rounded-2xl border border-line bg-white p-6 shadow-[0_12px_36px_#002a3410] sm:p-10">
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
            signInHref={`/login?next=${encodeURIComponent(`/${city}/${locality}/${category}/${slug}`)}`}
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

      <Reviews
        summary={reviews}
        businessName={listing.name}
        signedIn={signedIn}
        writeHref={`/login?next=${encodeURIComponent(`/${city}/${locality}/${category}/${slug}`)}`}
      >
        <ReviewForm city={city} locality={locality} slug={slug} />
      </Reviews>

      {/*
        Call and WhatsApp reach the owner immediately but leave no record. This form does: it
        becomes an enquiry in the owner's dashboard, so a missed call is not a lost customer.
      */}
      <section
        id="enquiry"
        aria-labelledby="enquiry-heading"
        className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_28px_#002a3412] sm:p-7"
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
  );
}
