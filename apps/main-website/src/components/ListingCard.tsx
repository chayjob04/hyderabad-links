import Link from "next/link";
import { initialsOf } from "@/components/ui/BusinessCard";
import type { SearchListing } from "@/lib/types";
import { formatDistance, telHref, whatsappHref } from "@/lib/format";

/**
 * One business in a list of results. Shared by `/search` and the locality + category pages, so
 * both show a business the same way.
 *
 * It shows only what the API actually returns: there is still no rating and no opening hours here,
 * because neither exists in the database. The logo is real when the business has uploaded one, and
 * its first photo stands in when it has not; a monogram is the last resort.
 */
export function ListingCard({ listing }: { listing: SearchListing }) {
  const image = listing.logoUrl ?? listing.photoUrl;
  // Addresses usually already end with the area, so the area is only appended when it is missing.
  const address = listing.addressLine?.trim();
  const where =
    !address ? listing.localityName
    : address.toLowerCase().includes(listing.localityName.toLowerCase()) ? address
    : `${address}, ${listing.localityName}`;

  return (
    <li className="flex flex-col rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_#002a3417]">
      <div className="flex items-start justify-between gap-3">
        {image ? (
          // Decorative: the business name is right below it, so repeating it here only makes a
          // screen reader say the same thing twice.
          <img
            src={image}
            alt=""
            loading="lazy"
            className="h-14 w-14 shrink-0 rounded-full border border-brand-200 bg-white object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-brand-200 bg-brand-50 text-lg font-black text-brand-700"
          >
            {initialsOf(listing.name)}
          </span>
        )}
        {/* Only shown when the search knew where the visitor was. */}
        {listing.distanceMetres !== null ? (
          <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-extrabold text-brand-800">
            {formatDistance(listing.distanceMetres)}
          </span>
        ) : null}
      </div>

      <p className="mt-4 text-xs font-black tracking-[0.1em] text-muted uppercase">{listing.categoryName}</p>
      <h3 className="mt-1 text-lg leading-snug font-black text-ink">
        <Link href={listing.url} className="hover:text-brand-700">
          {listing.name}
        </Link>
        {/* Inline with the name, not floated on the logo as BusinessCard does it: this card is a
            row of text rather than a portrait, and a tick on the avatar would sit a long way from
            the business it is vouching for. The tick carries it visually; the label is for screen
            readers, and `title` gives a sighted visitor the same words on hover. */}
        {listing.isVerified ? (
          <span
            title="Verified business"
            className="ml-1.5 inline-grid h-5 w-5 translate-y-0.5 place-items-center rounded-full bg-brand-700 text-white align-baseline"
          >
            <span className="sr-only">Verified business</span>
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3 w-3" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        ) : null}
      </h3>
      <p className="mt-1.5 text-sm text-muted">{where}</p>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex gap-2">
          <a
            href={telHref(listing.phonePrimary)}
            className="rounded-full bg-brand-700 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800"
          >
            Call
          </a>
          {listing.phoneWhatsapp ? (
            <a
              href={whatsappHref(listing.phoneWhatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-brand-200 px-4 py-2 text-sm font-bold text-brand-700 hover:border-brand-700 hover:bg-brand-50"
            >
              WhatsApp
            </a>
          ) : null}
        </div>
        <Link href={listing.url} className="text-sm font-black text-brand-700 hover:underline">
          View business <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </li>
  );
}
