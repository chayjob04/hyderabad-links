import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { ListingStaffNav } from "@/components/ListingStaffNav";
import { PageTitle } from "@/components/minia/PageTitle";
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

/**
 * Staff writing a listing's FAQs — the original's `Super/EditListingFaqs`.
 *
 * A business added by staff has no account to write its own questions with, so somebody has to be
 * able to. The plan allowance is shown and enforced, and questions beyond it are marked hidden
 * rather than removed (D10): downgrading a plan must not destroy what was written under it.
 */
export default async function StaffFaqsPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { done, error } = await searchParams;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listing, faqs, me] = await Promise.all([getListing(id), getListingFaqs(id), getProfile()]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);

  if (me.ok && !mayEdit) {
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="this listing" />;
  }
  if (!listing.ok && listing.status === 404) notFound();

  const full = faqs.ok && faqs.data.used >= faqs.data.limit;
  const name = listing.ok ? listing.data.name : `Listing ${id}`;

  return (
    <>
      <PageTitle
        title={name}
        breadcrumb={[{ label: "Listings", href: "/super-admin/listings" }, { label: "FAQs" }]}
        action={
          <Link href={`/super-admin/listings/${id}`} className="btn btn-outline-secondary">
            <i className="mdi mdi-arrow-left me-1" /> Listing
          </Link>
        }
      />

      <ListingStaffNav listingId={id} current="faqs" />

      {done ? (
        <div role="status" className="alert alert-success">
          {done}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      ) : null}

      {!faqs.ok ? (
        <div role="alert" className="alert alert-danger">
          {faqs.message}
        </div>
      ) : (
        <div className="row g-3">
          <div className="col-xl-5">
            <div className="card h-100">
              <div className="card-body">
                <h4 className="card-title mb-1">Add a question</h4>
                <p className="card-title-desc mb-3">
                  {faqs.data.used} of {faqs.data.limit} used on the {faqs.data.planName} plan.
                  {faqs.data.limit === 0
                    ? " This plan does not include FAQs — the Verified plan does."
                    : ""}
                </p>

                {mayEdit && !full && faqs.data.limit > 0 ? (
                  <form action={addFaqAction.bind(null, id)}>
                    <div className="mb-3">
                      <label className="form-label" htmlFor="question">
                        Question
                      </label>
                      <input
                        id="question"
                        name="question"
                        maxLength={300}
                        required
                        placeholder="Do you deliver?"
                        className="form-control"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label" htmlFor="answer">
                        Answer
                      </label>
                      <textarea
                        id="answer"
                        name="answer"
                        maxLength={2000}
                        rows={4}
                        required
                        placeholder="Yes, within 5km, free over ₹300."
                        className="form-control"
                      />
                    </div>
                    <button type="submit" className="btn btn-primary">
                      Add
                    </button>
                  </form>
                ) : full ? (
                  <div className="alert alert-warning mb-0">
                    This listing has all {faqs.data.limit} questions its plan allows. Remove one to
                    add another.
                  </div>
                ) : (
                  <p className="text-muted font-size-13 mb-0">
                    Nothing can be added on this plan.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="col-xl-7">
            <div className="card h-100">
              <div className="card-body">
                <h4 className="card-title mb-1">Questions</h4>
                <p className="card-title-desc mb-3">Shown on the public page in this order.</p>

                {faqs.data.items.length === 0 ? (
                  <p className="text-muted font-size-13 mb-0">None written yet.</p>
                ) : (
                  faqs.data.items.map((faq, index) => (
                    <div key={faq.id} className="border rounded p-3 mb-2">
                      <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
                        <h5 className="font-size-14 mb-0">{faq.question}</h5>
                        {mayEdit ? (
                          <form action={deleteFaqAction.bind(null, id, faq.id)}>
                            <button type="submit" className="btn btn-sm btn-outline-danger">
                              Remove
                            </button>
                          </form>
                        ) : null}
                      </div>
                      <p className="text-muted mt-2 mb-0" style={{ whiteSpace: "pre-line" }}>
                        {faq.answer}
                      </p>
                      {/* Beyond the allowance: kept, not deleted (D10), but the public page does
                          not show it. Saying so here is the whole reason this screen lists them. */}
                      {index >= faqs.data.limit ? (
                        <div className="alert alert-warning py-2 px-3 mt-2 mb-0 font-size-12">
                          Hidden &mdash; beyond what the {faqs.data.planName} plan shows. It is kept
                          and returns if the plan is upgraded.
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
