/**
 * Shown while one of a listing's screens is being built on the server.
 *
 * Every screen under `/account/listings/[id]` is `force-dynamic` and makes two or three API calls
 * before it renders anything — the listing, its media or links, and since the Verified work its
 * plan as well. Without this the browser sat on the previous screen with no sign that the tab had
 * been followed, which reads as a dead link rather than as work in progress. One file covers all
 * eleven of them, because they share a shape: a heading, the row of tabs, and a panel.
 *
 * The skeleton mirrors that shape rather than guessing at the content, so the page does not jump
 * when the real thing arrives. `role="status"` carries the sentence a screen reader announces; the
 * grey blocks are decorative and hidden from it, as on the search skeleton this follows.
 *
 * <b>`max-w-3xl`, which is a compromise.</b> Five of the eleven screens are `max-w-3xl` (About,
 * Alerts, Edit, Hours, Preview), five are `max-w-4xl` and Created is `max-w-2xl` — and one shared
 * loading file cannot know which child is about to render. This was `max-w-4xl` and so sat wider
 * than the content on six screens, which is the horizontal shift the skeleton exists to avoid.
 * Matching the larger group exactly is the alternative, at the cost of eleven near-identical
 * files. Note that none of this is visible below about 768px, where the viewport is narrower than
 * every one of those limits and `px-5` governs instead.
 */
export default function ListingScreenLoading() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div role="status">
        <span className="sr-only">Loading this listing…</span>
        <div aria-hidden="true" className="h-3 w-16 animate-pulse rounded-full bg-line" />
        <div aria-hidden="true" className="mt-3 h-8 w-72 max-w-full animate-pulse rounded-lg bg-brand-100" />
        <div aria-hidden="true" className="mt-2 h-4 w-44 max-w-full animate-pulse rounded-full bg-line" />
      </div>

      {/* The tab row. Widths vary because the real labels do, and an even row of identical pills
          would settle into something visibly different when the text arrives. */}
      <div aria-hidden="true" className="mt-5 flex flex-wrap gap-x-4 gap-y-2">
        {[72, 56, 104, 88, 80, 96].map((width) => (
          <div
            key={width}
            className="h-4 animate-pulse rounded-full bg-brand-50"
            style={{ width }}
          />
        ))}
      </div>

      <div aria-hidden="true" className="mt-8 rounded-2xl border border-line bg-white px-6 py-5">
        <div className="h-5 w-48 max-w-full animate-pulse rounded-full bg-brand-100" />
        <div className="mt-4 h-3 w-full animate-pulse rounded-full bg-line" />
        <div className="mt-2.5 h-3 w-5/6 animate-pulse rounded-full bg-line" />
        <div className="mt-2.5 h-3 w-2/3 animate-pulse rounded-full bg-line" />
        <div className="mt-6 h-10 w-40 animate-pulse rounded-full bg-brand-50" />
      </div>
    </main>
  );
}
