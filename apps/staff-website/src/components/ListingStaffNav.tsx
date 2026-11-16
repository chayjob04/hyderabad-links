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
 *
 * On `nav nav-pills`, the same control the sign-in page uses for its two tabs. It kept its Tailwind
 * styling when the listing screens were migrated, which left a grey-and-white tab strip sitting
 * inside four otherwise fully themed pages.
 */
export function ListingStaffNav({
  listingId,
  current,
}: {
  listingId: number;
  current: StaffListingScreen;
}) {
  return (
    <ul className="nav nav-pills mb-3" aria-label="This listing">
      {SCREENS.map((screen) => {
        const active = screen.key === current;
        return (
          <li key={screen.key} className="nav-item">
            <Link
              href={`/super-admin/listings/${listingId}${screen.path}`}
              aria-current={active ? "page" : undefined}
              className={`nav-link${active ? " active" : ""}`}
            >
              {screen.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
