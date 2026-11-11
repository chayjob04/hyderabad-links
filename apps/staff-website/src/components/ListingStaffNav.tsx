import Link from "next/link";

export type StaffListingScreen = "detail" | "content" | "faqs" | "links";

const SCREENS: { key: StaffListingScreen; path: string; label: string }[] = [
  { key: "detail", path: "", label: "Details" },
  { key: "content", path: "/content", label: "About" },
  { key: "faqs", path: "/faqs", label: "FAQs" },
  { key: "links", path: "/links", label: "Links" },
];

/**
 * The tabs across a staff listing screen.
 *
 * In one place because there are four of them and they are reached from each other, not from the
 * sidebar — a listing is the thing being worked on, so the sidebar stays on "Listings" throughout.
 *
 * `aria-current` rather than only a colour: the current tab has to be announced, not just look
 * different.
 */
export function ListingStaffNav({
  listingId,
  current,
}: {
  listingId: number;
  current: StaffListingScreen;
}) {
  return (
    <nav aria-label="This listing" className="mt-4 flex flex-wrap gap-2 border-b border-neutral-200 pb-4">
      {SCREENS.map((screen) => {
        const active = screen.key === current;
        return (
          <Link
            key={screen.key}
            href={`/super-admin/listings/${listingId}${screen.path}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              active ?
                "bg-neutral-900 text-white"
              : "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
            }`}
          >
            {screen.label}
          </Link>
        );
      })}
    </nav>
  );
}
