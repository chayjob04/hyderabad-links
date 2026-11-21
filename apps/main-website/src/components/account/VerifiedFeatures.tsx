import Link from "next/link";
import { UpgradeModal } from "@/components/account/UpgradeModal";

/**
 * A small padlock, drawn rather than imported.
 *
 * One glyph does not justify an icon package, and the site already draws its own marks this way.
 * `currentColor` so a row decides its own colour, and `aria-hidden` because the lock repeats what
 * the row's own words already say — a screen reader that announced "lock" before every locked
 * feature would be reading decoration.
 */
export function LockIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" opacity="0.25" />
      <rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** One row of the list below: what the feature is, and what state it is in for this listing. */
export type VerifiedFeature = {
  title: string;
  /** Why an owner would want it. Shown whether it is locked or not. */
  benefit: string;
  /**
   * What to show on the right when the feature is unlocked: usually usage, like "3 / 5 used".
   * `null` for the two that are built but not finished, which say so for themselves.
   */
  usage: string | null;
  /** Where the feature lives, when it has a screen of its own and is usable. */
  href?: string;
  /** Shown instead of usage when the feature is unlocked but not finished. */
  comingSoon?: boolean;
};

/**
 * What the Verified listing includes, and for a free listing, what is locked.
 *
 * <b>One list, both states.</b> A free owner sees every feature with a padlock and a price; a paid
 * one sees the same rows with their usage. That is deliberate: a dashboard that hides what you have
 * not bought cannot tell you what buying would give you, and the previous version of this
 * dashboard hid the whole photos screen from free listings — so the only way to find out what
 * Verified included was to open the payment page.
 *
 * It is a plain list rather than a grid of cards. Six cards would be six boxes competing with the
 * screen they sit on; rows with a rule between them read as one thing with six parts, which is
 * what this is.
 *
 * Everything quantitative is passed in, read from the API by the page above: the price comes from
 * the `plans` row and the usage from `listing_entitlements`, so nothing here can quote a number the
 * database disagrees with.
 */
export function VerifiedFeatures({
  listingId,
  verified,
  priceLabel,
  paymentsLive,
  features,
}: {
  listingId: number;
  verified: boolean;
  priceLabel: string;
  paymentsLive: boolean;
  features: VerifiedFeature[];
}) {
  return (
    <ul className="divide-y divide-line">
      {features.map((feature) => (
        <li
          key={feature.title}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3.5"
        >
          <div className="min-w-0 basis-full sm:basis-auto">
            <p className="flex items-center gap-2 text-sm font-black text-ink">
              {/* The lock sits with the name, muted, at text size: present enough to read as
                  "not yours yet" and quiet enough not to look like a warning. */}
              {!verified ? <LockIcon className="size-3.5 shrink-0 text-muted" /> : null}
              {verified && feature.href ? (
                <Link href={feature.href} className="text-brand-700 hover:underline">
                  {feature.title}
                </Link>
              ) : (
                feature.title
              )}
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted">{feature.benefit}</p>
          </div>

          <div className="shrink-0 text-sm font-bold">
            {verified ? (
              feature.comingSoon ? (
                <span className="text-muted">Coming soon</span>
              ) : (
                <span className="text-ink">{feature.usage}</span>
              )
            ) : (
              <UpgradeModal
                listingId={listingId}
                priceLabel={priceLabel}
                featureTitle={feature.title}
                featureBenefit={feature.benefit}
                paymentsLive={paymentsLive}
                trigger={
                  <button
                    type="button"
                    className="cursor-pointer text-sm font-black text-brand-700 hover:underline"
                  >
                    Unlock
                  </button>
                }
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
