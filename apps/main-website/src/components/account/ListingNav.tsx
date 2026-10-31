import Link from "next/link";

/**
 * The links between one listing's screens.
 *
 * This markup was repeated inline on each page, which is how the set drifted: the subscription
 * page offered one combination, the links page another, and two new screens had nowhere obvious
 * to be added. One component means adding a screen is one edit.
 *
 * The current page is rendered as plain text rather than a link to itself — a link that goes
 * nowhere is a small lie, and it also tells someone where they are.
 */
export function ListingNav({ listingId, current }: { listingId: number; current: ListingScreen }) {
  const items: { key: ListingScreen; href: string; label: string }[] = [
    { key: "edit", href: `/account/listings/${listingId}/edit`, label: "Edit details" },
    { key: "photos", href: `/account/listings/${listingId}/photos`, label: "Photos and video" },
    { key: "hours", href: `/account/listings/${listingId}/hours`, label: "Opening hours" },
    { key: "about", href: `/account/listings/${listingId}/about`, label: "About & FAQs" },
    { key: "links", href: `/account/listings/${listingId}/links`, label: "Website and social links" },
    { key: "subscription", href: `/account/listings/${listingId}/subscription`, label: "Plan and payment" },
  ];

  return (
    <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm font-bold">
      {items.map((item) =>
        item.key === current ? (
          <span key={item.key} aria-current="page" className="text-ink">
            {item.label}
          </span>
        ) : (
          <Link key={item.key} href={item.href} className="text-brand-700 hover:underline">
            {item.label}
          </Link>
        ),
      )}
      <Link href="/account/listings" className="text-muted hover:underline">
        All listings
      </Link>
    </nav>
  );
}

export type ListingScreen = "edit" | "photos" | "hours" | "about" | "links" | "subscription";
