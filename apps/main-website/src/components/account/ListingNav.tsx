import Link from "next/link";
import { LockIcon } from "@/components/account/VerifiedFeatures";

/**
 * The links between one listing's screens.
 *
 * This markup was repeated inline on each page, which is how the set drifted: the subscription
 * page offered one combination, the links page another, and two new screens had nowhere obvious
 * to be added. One component means adding a screen is one edit.
 *
 * The current page is rendered as plain text rather than a link to itself — a link that goes
 * nowhere is a small lie, and it also tells someone where they are.
 *
 * <b>Nothing is hidden from a free listing any more.</b> "Photos and video" used to be dropped
 * from this list entirely when the plan did not include media, which meant the only way to learn
 * that photos existed was to open the payment screen. Every screen is listed for everybody now,
 * with a padlock beside the ones the plan does not include, and the screen itself explains what
 * upgrading would unlock. A feature you cannot see is a feature you cannot want.
 */
export function ListingNav({ listingId, current, verified }: Props) {
  /* What is left is what is not business information: two promotional screens and the plan. The
     rows that used to be here -- edit, preview, photos, hours, about, links -- are sections of the
     editor now, which is why there is one row for it rather than six. */
  const items: { key: ListingScreen; href: string; label: string; locked?: boolean }[] = [
    { key: "edit", href: `/account/listings/${listingId}/edit`, label: "Listing details" },
    {
      key: "promote",
      href: `/account/listings/${listingId}/promote`,
      label: "Promote",
      locked: !verified,
    },
    { key: "ads", href: `/account/listings/${listingId}/ads`, label: "Ads", locked: !verified },
    { key: "subscription", href: `/account/listings/${listingId}/subscription`, label: "Plan and payment" },
  ];

  return (
    <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm font-bold">
      {items.map((item) =>
        item.key === current ? (
          <span key={item.key} aria-current="page" className="inline-flex items-center gap-1.5 text-ink">
            {item.locked ? <LockIcon className="size-3 text-muted" /> : null}
            {item.label}
          </span>
        ) : (
          <Link
            key={item.key}
            href={item.href}
            /* A locked row still navigates. The screen behind it is where the feature is explained
               and where the upgrade prompt lives, so sending somebody to a dialog from here would
               take away the page they were trying to reach. */
            className={`inline-flex items-center gap-1.5 hover:underline ${
              item.locked ? "text-muted" : "text-brand-700"
            }`}
          >
            {item.locked ? <LockIcon className="size-3" /> : null}
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

type Props = {
  listingId: number;
  current: ListingScreen;
  /**
   * Whether the listing's plan is in force right now. Nothing is hidden when it is not: the rows
   * it does not include carry a padlock instead, and each screen explains what upgrading unlocks.
   */
  verified: boolean;
};

export type ListingScreen =
  | "edit"
  | "promote"
  | "ads"
  | "subscription";
