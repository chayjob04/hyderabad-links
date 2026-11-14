import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { ListingStaffNav } from "@/components/ListingStaffNav";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_LISTINGS_EDIT,
  getListing,
  getListingContent,
  getProfile,
} from "@/lib/super-admin-api";
import { addContentAction, deleteContentAction } from "../content-actions";

export const metadata: Metadata = { title: "About" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> };

/**
 * Staff writing a listing's description sections — the original's `Super/EditListingContent`.
 *
 * Same reason as the FAQ editor: a business added by staff has no account to write its own About
 * with. The plan allowance is shown and enforced here too, and sections beyond it are marked
 * hidden rather than removed (D10).
 */
export default async function StaffContentPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { done, error } = await searchParams;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listing, content, me] = await Promise.all([
    getListing(id),
    getListingContent(id),
    getProfile(),
  ]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);

  if (me.ok && !mayEdit) {
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="this listing" />;
  }
  if (!listing.ok && listing.status === 404) notFound();

  const full = content.ok && content.data.used >= content.data.limit;
  const name = listing.ok ? listing.data.name : `Listing ${id}`;

  return (
    <>
      <PageTitle
        title={name}
        breadcrumb={[{ label: "Listings", href: "/super-admin/listings" }, { label: "About" }]}
        action={
          <Link href={`/super-admin/listings/${id}`} className="btn btn-outline-secondary">
            <i className="mdi mdi-arrow-left me-1" /> Listing
          </Link>
        }
      />

      <ListingStaffNav listingId={id} current="content" />

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

      {!content.ok ? (
        <div role="alert" className="alert alert-danger">
          {content.message}
        </div>
      ) : (
        <div className="row g-3">
          <div className="col-xl-5">
            <div className="card h-100">
              <div className="card-body">
                <h4 className="card-title mb-1">Add a section</h4>
                <p className="card-title-desc mb-3">
                  {content.data.used} of {content.data.limit} used on the {content.data.planName}{" "}
                  plan.
                  {content.data.limit === 0
                    ? " This plan does not include description sections — the Verified plan does."
                    : ""}
                </p>

                {mayEdit && !full && content.data.limit > 0 ? (
                  <form action={addContentAction.bind(null, id)}>
                    <div className="mb-3">
                      <label className="form-label" htmlFor="heading">
                        Heading
                      </label>
                      <input
                        id="heading"
                        name="heading"
                        maxLength={200}
                        required
                        placeholder="About our clinic"
                        className="form-control"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label" htmlFor="body">
                        Text
                      </label>
                      <textarea
                        id="body"
                        name="body"
                        maxLength={4000}
                        rows={6}
                        required
                        className="form-control"
                      />
                      <div className="form-text">
                        Plain text. It is shown on the public page exactly as typed &mdash; markup
                        is not rendered.
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary">
                      Add
                    </button>
                  </form>
                ) : full ? (
                  <div className="alert alert-warning mb-0">
                    This listing has all {content.data.limit} sections its plan allows. Remove one to
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
                <h4 className="card-title mb-1">Sections</h4>
                <p className="card-title-desc mb-3">
                  Shown on the public page in this order.
                </p>

                {content.data.items.length === 0 ? (
                  <p className="text-muted font-size-13 mb-0">Nothing written yet.</p>
                ) : (
                  content.data.items.map((section, index) => (
                    <div key={section.id} className="border rounded p-3 mb-2">
                      <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
                        <h5 className="font-size-14 mb-0">{section.heading}</h5>
                        {mayEdit ? (
                          <form action={deleteContentAction.bind(null, id, section.id)}>
                            <button type="submit" className="btn btn-sm btn-outline-danger">
                              Remove
                            </button>
                          </form>
                        ) : null}
                      </div>
                      <p className="text-muted mt-2 mb-0" style={{ whiteSpace: "pre-line" }}>
                        {section.body}
                      </p>
                      {index >= content.data.limit ? (
                        <div className="alert alert-warning py-2 px-3 mt-2 mb-0 font-size-12">
                          Hidden &mdash; beyond what the {content.data.planName} plan shows. It is
                          kept and returns if the plan is upgraded.
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
