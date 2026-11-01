import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingNav } from "@/components/account/ListingNav";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getListingAttributes,
  getListingFaqs,
  getListingLinks,
  getListingMedia,
  getMyListing,
  getOpeningHours,
} from "@/lib/owner-api";

export const metadata: Metadata = { title: "Preview" };

type Props = { params: Promise<{ id: string }> };

/**
 * What the owner has filled in, gathered on one page — the original's `BO/ViewListing`.
 *
 * Deliberately a checklist rather than a copy of the public page. A draft has no public page yet,
 * and the question an owner actually has before sending one for review is "what have I left out",
 * which a faithful rendering answers badly: everything missing simply is not there to see. Each
 * row says plainly when it is empty and links to the screen that fills it.
 */
export default async function ListingPreviewPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listingResult, media, hours, faqs, links, attributes] = await Promise.all([
    getMyListing(id),
    getListingMedia(id),
    getOpeningHours(id),
    getListingFaqs(id),
    getListingLinks(id),
    getListingAttributes(id),
  ]);

  if (!listingResult.ok) {
    if (listingResult.status === 404) notFound(); // also what another owner's listing looks like
    return (
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <EmptyState tone="error" mark="&#9888;" title="We could not load this listing">
          <p>{listingResult.message}</p>
        </EmptyState>
      </main>
    );
  }

  const listing = listingResult.data;

  /* A count, not the content: the editors show the detail. "Could not load" is kept distinct from
     "none" on purpose — telling an owner they have no photos when the request simply failed would
     send them to re-upload what is already there. */
  const counted = (ok: boolean, n: number, noneLabel: string, someLabel: string) =>
    !ok ? "Could not load"
    : n > 0 ? `${n} ${someLabel}`
    : noneLabel;

  const rows: { label: string; value: string; href: string; done: boolean }[] = [
    {
      label: "Description",
      value: listing.description?.trim() ? "Written" : "Not written yet",
      href: `/account/listings/${id}/edit`,
      done: Boolean(listing.description?.trim()),
    },
    {
      label: "Address",
      value: listing.addressLine?.trim() || "Not added yet",
      href: `/account/listings/${id}/edit`,
      done: Boolean(listing.addressLine?.trim()),
    },
    {
      label: "Photos and video",
      value: counted(media.ok, media.ok ? media.data.items.length : 0, "None added", "added"),
      href: `/account/listings/${id}/photos`,
      done: media.ok && media.data.items.length > 0,
    },
    {
      label: "Opening hours",
      value: counted(hours.ok, hours.ok ? hours.data.intervals.length : 0, "Not set", "set"),
      href: `/account/listings/${id}/hours`,
      done: hours.ok && hours.data.intervals.length > 0,
    },
    {
      label: "FAQs",
      value: counted(faqs.ok, faqs.ok ? faqs.data.items.length : 0, "None written", "written"),
      href: `/account/listings/${id}/about`,
      done: faqs.ok && faqs.data.items.length > 0,
    },
    {
      label: "Offerings, languages and amenities",
      value: counted(
        attributes.ok,
        attributes.ok ? attributes.data.items.length : 0,
        "None listed",
        "listed",
      ),
      href: `/account/listings/${id}/about`,
      done: attributes.ok && attributes.data.items.length > 0,
    },
    {
      label: "Website and social links",
      value: counted(links.ok, links.ok ? links.data.items.length : 0, "None added", "added"),
      href: `/account/listings/${id}/links`,
      done: links.ok && links.data.items.length > 0,
    },
  ];

  const missing = rows.filter((row) => !row.done).length;

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

        <ListingNav listingId={id} current="preview" verified={listing.verified} />
      </div>

      <p className="mt-6 text-muted">
        {missing === 0 ?
          "Everything a visitor looks for is filled in."
        : `${missing} ${missing === 1 ? "thing is" : "things are"} still empty. A listing works without them, but it wins less attention.`}
      </p>

      <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-white">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
          >
            <div className="min-w-0">
              <p className="font-black text-ink">
                <span aria-hidden="true" className={row.done ? "text-green-700" : "text-muted"}>
                  {row.done ? "✓" : "○"}
                </span>{" "}
                {row.label}
              </p>
              <p className="mt-0.5 truncate text-sm text-muted">{row.value}</p>
            </div>
            <Link href={row.href} className="text-sm font-black text-brand-700 hover:underline">
              {row.done ? "Change" : "Add"} <span aria-hidden="true">&rarr;</span>
            </Link>
          </li>
        ))}
      </ul>

      {listing.status === "active" ? (
        <p className="mt-6">
          <Link
            href={listing.url}
            className="inline-block rounded-full bg-brand-700 px-5 py-2.5 text-sm font-black text-white hover:bg-brand-800"
          >
            View the live page
          </Link>
        </p>
      ) : (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This listing is not live yet, so there is no public page to open. Everything above is
          saved and appears the moment it is approved.
        </p>
      )}
    </main>
  );
}
