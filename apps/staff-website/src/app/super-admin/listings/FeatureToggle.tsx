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
 *
 * On the theme's button classes. The hand-built track and knob are gone: `btn-primary` when it is
 * on and an outline when it is off says the same thing in the vocabulary the rest of these panels
 * already use, and a star reads as "featured" without needing the word.
 */
export function FeatureToggle({ listingId, featured, returnTo, live }: Props) {
  if (!live && !featured) {
    return (
      <span
        className="text-muted font-size-12"
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
        className={`btn btn-sm ${featured ? "btn-primary" : "btn-outline-secondary"}`}
      >
        <i className={`${featured ? "bx bxs-star" : "bx bx-star"} align-middle me-1`} />
        {featured ? "Featured" : "Feature"}
      </button>
    </form>
  );
}
