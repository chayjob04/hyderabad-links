import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_ALERT,
  PERMISSION_REVIEW,
  formatWhen,
  getAdminProfile,
  getListing,
  getListingAlerts,
} from "@/lib/admin-api";
import { AlertForm } from "./AlertForm";
import { DecisionForm } from "./DecisionForm";
import { LiveStatusForm } from "./LiveStatusForm";

export const metadata: Metadata = { title: "Review listing" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string; live?: string }> };

/**
 * One labelled fact, as a table row.
 *
 * A definition list of label-above-value took two lines per fact and ran the card to twice the
 * height it needed. Label left, value right, one line each: the same information, scannable in a
 * column rather than a scroll.
 */
function Field({
  label,
  value,
  block = false,
}: {
  label: string;
  value: string | null;
  /*
   * A value too long to sit opposite its label. A description is a paragraph, and forcing one into
   * a right-aligned 60% cell gives four ragged lines running away from the eye. `block` puts the
   * label on its own line and lets the text start at the left margin, where prose is read.
   */
  block?: boolean;
}) {
  const shown = value && value.trim() !== "" ? value : <span className="text-muted">—</span>;

  if (block) {
    return (
      <tr>
        <td colSpan={2} className="px-0 py-3">
          <span className="d-block text-muted mb-1">{label}</span>
          <span className="d-block lh-base" style={{ whiteSpace: "pre-line" }}>
            {shown}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <th scope="row" className="fw-normal text-muted ps-0" style={{ width: "40%" }}>
        {label}
      </th>
      <td className="text-end pe-0 text-break">{shown}</td>
    </tr>
  );
}

export default async function ReviewListingPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { added, live } = await searchParams;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isSafeInteger(id) || id < 1) notFound();

  const [result, me, alerts] = await Promise.all([getListing(id), getAdminProfile(), getListingAlerts(id)]);

  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <>
        <PageTitle title="Listing" breadcrumb={[{ label: "Listings", href: "/admin/listings" }]} />
        <div role="alert" className="alert alert-danger">
          {result.message}
        </div>
      </>
    );
  }

  const listing = result.data;
  const mapsLink = `https://www.google.com/maps?q=${listing.latitude},${listing.longitude}`;
  // The API enforces this; the page only avoids showing a form that would be refused.
  const mayReview = me.ok && me.data.permissions.includes(PERMISSION_REVIEW);
  const mayAlert = me.ok && me.data.permissions.includes(PERMISSION_ALERT);

  return (
    <>
      <PageTitle
        title={listing.name}
        breadcrumb={[{ label: "Listings", href: "/admin/listings" }, { label: listing.name }]}
        action={
          <Link href="/admin/listings" className="btn btn-outline-secondary">
            <i className="mdi mdi-arrow-left me-1" /> Back to the queue
          </Link>
        }
      />

      {added ? (
        <div role="status" className="alert alert-success">
          {listing.status === "active"
            ? "Listing added and published. It is on the public site now."
            : "Listing added. It is in the review queue, waiting for someone who can publish it."}
        </div>
      ) : null}

      {live ? (
        <div role="status" className="alert alert-success">
          {live === "suspended"
            ? "Listing suspended. It is off the public site and the owner can see why."
            : "Listing put back. It is on the public site again."}
        </div>
      ) : null}

      {listing.reviewNote ? (
        <div className="alert alert-warning">
          <span className="fw-semibold">Last rejection reason:</span> {listing.reviewNote}
        </div>
      ) : null}

      <div className="row g-3 mb-4">
        {/* Who this is, and the decision, side by side: a reviewer needs both in one screen rather
            than scrolling between the facts and the buttons that act on them. */}
        <div className="col-xl-4">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex align-items-start justify-content-between gap-2 mb-3">
                <div className="min-w-0">
                  <h5 className="font-size-15 mb-1">{listing.name}</h5>
                  <p className="text-muted font-size-13 mb-0">
                    {listing.categoryName ?? "No category"} &middot; {listing.localityName}
                  </p>
                </div>
                <StatusBadge status={listing.status} />
              </div>

              <table className="table table-sm mb-0">
                <tbody>
                  <Field label="Description" value={listing.description} block />
                  <Field label="Address" value={listing.addressLine} />
                  <Field label="Pincode" value={listing.pincode} />
                  <Field label="Phone" value={listing.phonePrimary} />
                  <Field label="WhatsApp" value={listing.phoneWhatsapp} />
                  <Field label="Email" value={listing.email} />
                  <Field label="Website" value={listing.websiteUrl} />
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-xl-4">
          <div className="card h-100">
            <div className="card-body">
              <h4 className="card-title mb-3">History and plan</h4>
              <table className="table table-sm mb-3">
                <tbody>
                  {/* The plan, from the entitlement view: "Verified until …" while a period is
                      running, and plain "Free" once it is not. Worth knowing before suspending a
                      business that is paying for the page you are about to take down. */}
                  <Field
                    label="Plan"
                    value={
                      listing.isVerified
                        ? `Verified${listing.paidUntil ? ` until ${formatWhen(listing.paidUntil)}` : ""}`
                        : "Free"
                    }
                  />
                  <Field label="Submitted by" value={listing.submittedByPhone} />
                  <Field label="Created" value={formatWhen(listing.createdAt)} />
                  <Field label="Last change" value={formatWhen(listing.updatedAt)} />
                  <Field label="First published" value={formatWhen(listing.publishedAt)} />
                  <Field
                    label="Last decision"
                    value={
                      listing.reviewedAt
                        ? `${formatWhen(listing.reviewedAt)} by ${listing.reviewedBy ?? "an admin"}`
                        : null
                    }
                  />
                  <Field
                    label="Map point"
                    value={`${listing.latitude.toFixed(5)}, ${listing.longitude.toFixed(5)}`}
                  />
                </tbody>
              </table>

              <div className="d-flex flex-wrap gap-2">
                <a href={mapsLink} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-secondary">
                  <i className="bx bx-map align-middle me-1" /> Map point
                </a>
                {listing.status === "active" && listing.url ? (
                  <a href={listing.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-secondary">
                    <i className="bx bx-link-external align-middle me-1" /> Public page
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="col-xl-4">
          <div className="card h-100">
            <div className="card-body">
              <h4 className="card-title mb-3">Decision</h4>
              {listing.status === "active" || listing.status === "suspended" ? (
                mayReview ? (
                  <LiveStatusForm listingId={listing.id} suspended={listing.status === "suspended"} />
                ) : (
                  <p className="text-muted font-size-13 mb-0">
                    Your account can view listings but not take them off the site.
                  </p>
                )
              ) : listing.status !== "pending_review" ? (
                <p className="text-muted font-size-13 mb-0">
                  This listing is not waiting for review, so there is nothing to decide. Owners can
                  submit a draft or rejected listing again themselves.
                </p>
              ) : mayReview ? (
                <DecisionForm listingId={listing.id} />
              ) : (
                <p className="text-muted font-size-13 mb-0">
                  Your account can view listings but not approve or reject them. Ask a super admin
                  for the &quot;Approve or reject listings&quot; permission.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Asking for a correction, and what has already been asked. Separate from the decision
          above, because it applies whatever the listing's status is: a live listing with a wrong
          phone number is the commonest case, and the point of this feature is that it no longer has
          to be suspended to get the number fixed. */}
      <div className="row g-3 align-items-start">
        <div className="col-xl-5">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-3">Ask the owner for a correction</h4>
              {mayAlert && alerts.ok ? (
                <AlertForm listingId={listing.id} reasons={alerts.data.reasons} />
              ) : (
                <p className="text-muted font-size-13 mb-0">
                  {mayAlert
                    ? "We could not load the message form. Reload the page to try again."
                    : "Your account cannot write to business owners. Ask a super admin for the “Send a correction request” permission."}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="col-xl-7">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-3">What has been asked already</h4>
              {!alerts.ok ? (
                <p className="text-muted font-size-13 mb-0">{alerts.message}</p>
              ) : alerts.data.items.length === 0 ? (
                <p className="text-muted font-size-13 mb-0">Nobody has written to this owner yet.</p>
              ) : (
                alerts.data.items.map((alert) => (
                  <div key={alert.id} className="border rounded p-3 mb-2">
                    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                      <span className="fw-semibold font-size-13">{alert.reasonLabel}</span>
                      <span
                        className={`badge ${
                          alert.acknowledgedAt === null
                            ? "bg-warning-subtle text-warning"
                            : "bg-secondary-subtle text-secondary"
                        }`}
                      >
                        {alert.acknowledgedAt === null ? "Not read yet" : "Read by the owner"}
                      </span>
                    </div>
                    <p className="mt-2 mb-2" style={{ whiteSpace: "pre-wrap" }}>
                      {alert.message}
                    </p>
                    <p className="text-muted font-size-12 mb-0">
                      {alert.sentByName} &middot; {formatWhen(alert.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
