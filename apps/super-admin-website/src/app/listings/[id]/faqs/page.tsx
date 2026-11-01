import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { ListingStaffNav } from "@/components/ListingStaffNav";
import {
  PERMISSION_LISTINGS_EDIT,
  getListing,
  getListingFaqs,
  getProfile,
} from "@/lib/super-admin-api";
import { addFaqAction, deleteFaqAction } from "../content-actions";

export const metadata: Metadata = { title: "FAQs" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> };

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

const BUTTON =
  "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50";

const ADD = "rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700";

/**
 * Staff writing a listing's FAQs — the original's `Super/EditListingFaqs`.
 *
 * It exists because most listings on a directory like this are added by staff for a business with
 * no account: somebody who walked in, phoned, or sent a WhatsApp. Without this screen the only way
 * to write their FAQs is to create an account in their name.
 *
 * The plan allowance is shown and enforced, the same as on the owner's own screen. A staff member
 * who could add a fifth question to a four-question plan would be writing something the public
 * views (`listing_visible_faqs`) then hide — so the limit is stated here rather than discovered.
 */
export default async function StaffFaqsPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { done, error } = await searchParams;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listing, faqs, me] = await Promise.all([getListing(id), getListingFaqs(id), getProfile()]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);

  if (me.ok && !mayEdit) {
    return <AccessDenied permission={PERMISSION_LISTINGS_EDIT} what="this listing" />;
  }
  if (!listing.ok && listing.status === 404) notFound();

  const full = faqs.ok && faqs.data.used >= faqs.data.limit;

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <Link href="/listings" className="text-sm font-semibold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> Listings
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{listing.ok ? listing.data.name : `Listing ${id}`}</h1>
      <ListingStaffNav listingId={id} current="faqs" />

      {done ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      ) : null}

      {!faqs.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {faqs.message}
        </p>
      ) : (
        <>
          <p className="mt-5 text-sm text-neutral-600">
            {faqs.data.used} of {faqs.data.limit} used on the {faqs.data.planName} plan.
            {faqs.data.limit === 0
              ? " This plan does not include FAQs — the Verified plan does."
              : ""}
          </p>

          {mayEdit && !full && faqs.data.limit > 0 ? (
            <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold">Add a question</h2>
              <form action={addFaqAction.bind(null, id)} className="mt-4 grid gap-3">
                <div>
                  <label className="text-sm font-semibold text-neutral-700" htmlFor="question">
                    Question
                  </label>
                  <input
                    id="question"
                    name="question"
                    maxLength={300}
                    required
                    placeholder="Do you deliver?"
                    className={`mt-1 ${INPUT}`}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-neutral-700" htmlFor="answer">
                    Answer
                  </label>
                  <textarea
                    id="answer"
                    name="answer"
                    maxLength={2000}
                    rows={3}
                    required
                    placeholder="Yes, within 5km, free over ₹300."
                    className={`mt-1 ${INPUT}`}
                  />
                </div>
                <div>
                  <button type="submit" className={ADD}>
                    Add
                  </button>
                </div>
              </form>
            </section>
          ) : full ? (
            <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-amber-900">
              This listing has all {faqs.data.limit} questions its plan allows. Remove one to add
              another.
            </p>
          ) : null}

          <section className="mt-6">
            <h2 className="text-base font-semibold">Questions</h2>
            {faqs.data.items.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">None written yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white shadow-sm">
                {faqs.data.items.map((faq, index) => (
                  <li key={faq.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{faq.question}</p>
                        <p className="mt-1 text-sm whitespace-pre-line text-neutral-600">{faq.answer}</p>
                      </div>
                      {mayEdit ? (
                        <form action={deleteFaqAction.bind(null, id, faq.id)}>
                          <button type="submit" className={BUTTON}>
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </div>
                    {/* Beyond the allowance: kept, not deleted (D10), but the public page does not
                        show it. Saying so here is the whole reason this screen lists them. */}
                    {index >= faqs.data.limit ? (
                      <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                        Hidden &mdash; beyond what the {faqs.data.planName} plan shows. It is kept and
                        returns if the plan is upgraded.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
