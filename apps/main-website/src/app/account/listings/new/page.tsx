import type { Metadata } from "next";
import Link from "next/link";
import { startNewListingAction } from "../../actions";

export const metadata: Metadata = { title: "Add your business" };

/**
 * Starting a new listing.
 *
 * It used to be the form itself, with four of its five sections closed and labelled "after
 * saving" — a photo, an opening time, a question and a link all belong to a listing, and there was
 * no listing until the form had been saved once. So the owner had to save, then come back for the
 * rest.
 *
 * Now the listing exists from the moment they press the button below (S0034): a draft nobody else
 * can see, marked as unsaved, which the editor opens with all five sections usable. One Save at the
 * end puts the whole thing away.
 *
 * <b>Why a button on a page rather than the editor itself.</b> This route is a GET, and creating a
 * row on a GET means creating one whenever a link to it is prefetched or a crawler follows it. The
 * button is a POST. Most owners never see this page -- "Add a business" on their listings screen is
 * the same POST -- and it is here so that a bookmark or a typed address still works.
 */
export default function NewListingPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:px-8">
      <Link href="/account/listings" className="text-sm font-bold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> Back to my listings
      </Link>

      <div className="mt-4 border-b border-line pb-5">
        <p className="text-[11px] font-black tracking-[0.22em] text-muted">BUSINESS OWNER</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-brand-800">Add your business</h1>
        <p className="mt-2 text-muted">
          Everything in one go: your details, photos, opening hours, questions and links. Nothing is
          saved until you say so, and nothing is public until we have reviewed it.
        </p>
      </div>

      <form action={startNewListingAction} className="mt-6">
        <button
          type="submit"
          className="cursor-pointer rounded-full bg-brand-700 px-7 py-3 text-base font-extrabold text-white hover:bg-brand-800"
        >
          Start
        </button>
      </form>

      <p className="mt-4 text-sm text-muted">
        You can leave and come back &mdash; an unfinished listing waits in My listings and does not
        count towards your five.
      </p>
    </main>
  );
}
