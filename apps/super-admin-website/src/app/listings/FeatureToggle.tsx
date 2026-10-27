import { setFeaturedAction } from "./actions";

type Props = {
  listingId: number;
  featured: boolean;
  /** Where to come back to, so the list does not jump to the listing's own page. */
  returnTo: string;
  /** Only a live listing can be featured; the API refuses the rest, and this says so first. */
  live: boolean;
};

/**
 * Put a listing on the homepage Featured shelf, or take it off, from wherever it is listed.
 *
 * One control rather than the button-plus-switch it was asked for: two controls doing the same
 * thing is how someone ends up pressing "Feature" on a listing that is already featured and
 * wondering what happened. This reads as a switch, says which state it is in, and the whole thing
 * is the button.
 *
 * A plain form posting a server action, so it works with no client JavaScript and the page it
 * returns to is re-read from the database rather than guessed at optimistically — the API can
 * refuse (a full shelf, a listing that is not live), and a toggle that had already flipped itself
 * would be lying.
 */
export function FeatureToggle({ listingId, featured, returnTo, live }: Props) {
  if (!live && !featured) {
    return (
      <span
        className="text-xs font-medium text-neutral-400"
        title="Only a live listing can be featured: a card on the homepage must lead somewhere the public can see."
      >
        Not featurable
      </span>
    );
  }

  return (
    <form action={setFeaturedAction.bind(null, listingId)}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        name="intent"
        value={featured ? "unfeature" : "feature"}
        aria-pressed={featured}
        title={featured ? "On the homepage. Click to remove." : "Put this on the homepage Featured shelf."}
        className={`flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-semibold transition ${
          featured
            ? "border-brand-700 bg-brand-50 text-brand-900 hover:bg-brand-100"
            : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-500"
        }`}
      >
        {/* The switch itself: a track with a knob that sits left when off and right when on. */}
        <span
          aria-hidden="true"
          className={`relative h-4 w-7 shrink-0 rounded-full transition ${featured ? "bg-brand-700" : "bg-neutral-300"}`}
        >
          <span
            className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${featured ? "left-3.5" : "left-0.5"}`}
          />
        </span>
        Feature
      </button>
    </form>
  );
}
