import { rupees } from "@/lib/format";

type Props = {
  /** What is in force now. Reads `free` the moment a paid period lapses, with no job having run. */
  planSlug: string;
  planName: string;
  verified: boolean;
  /** The paid plan's price in paise, from the `plans` table. Null when the API has not sent it. */
  pricePaise?: number | null;
  periodMonths?: number | null;
};

/**
 * The coloured band at the top of a listing card saying which plan that one listing is on.
 *
 * It is per listing, not per account, because that is how the plans are sold: a user with three
 * businesses can hold Verified on two and leave the third Free. A banner on the account would be
 * the wrong shape and would make the free one look paid.
 *
 * The price is passed in rather than written here. ₹399 lives in the `plans` table, and a figure
 * typed into a component is a promise that stops being true the day the price changes.
 */
export function PlanBanner({ planSlug, planName, verified, pricePaise, periodMonths }: Props) {
  const paid = verified && planSlug !== "free";

  /* Gold for paid, slate for free. Deliberately not green and red: Free is a perfectly good state
     that most listings are in, and colouring it like a failure would be both wrong and rude. */
  const tone = paid
    ? "border-amber-300 bg-gradient-to-r from-amber-50 to-amber-100/60 text-amber-900"
    : "border-line bg-slate-50 text-slate-600";

  const period =
    periodMonths === 12 ? "year" : periodMonths && periodMonths > 0 ? `${periodMonths} months` : null;

  const price =
    paid && pricePaise != null
      ? `${rupees(pricePaise)}${period ? `/${period}` : ""}`
      : paid
        ? null
        : rupees(0);

  return (
    <p
      className={`-mx-5 -mt-5 mb-4 flex items-center gap-2 rounded-t-xl border-b px-5 py-2.5 text-sm font-black ${tone}`}
    >
      {paid ? (
        <span aria-hidden="true" className="text-base leading-none">
          &#10003;
        </span>
      ) : null}
      <span>{paid ? `${planName} Listing` : "Free Listing"}</span>
      {price ? (
        <>
          <span aria-hidden="true" className="opacity-50">
            &middot;
          </span>
          <span className="font-bold">{price}</span>
        </>
      ) : null}
    </p>
  );
}
