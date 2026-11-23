import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, FilterTabs } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_REVIEW_CHANGES,
  formatWhen,
  getAdminProfile,
  getListingChanges,
  listListingChanges,
} from "@/lib/admin-api";
import { ChangeDecision } from "./ChangeDecision";

export const metadata: Metadata = { title: "Listing changes" };
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ status?: string; listing?: string; decided?: string }>;
};

const TABS = [
  { value: "pending_review", label: "Waiting for review" },
  { value: "rejected", label: "Sent back" },
  { value: "all", label: "Everything staged" },
] as const;

/**
 * Edits to listings that are already on the site — the half of moderation that could not exist
 * before S0031.
 *
 * A listing nobody has published yet is reviewed whole, in the listing queue: it is not on the site,
 * so approving it puts it there. An edit to a published listing is different, because the business
 * is already live and taking it down while somebody reads a corrected phone number is worse than
 * either answer. So the edit is staged and this screen decides it: the published values on the left,
 * the proposed ones on the right, changed rows marked.
 *
 * <b>Approving publishes it; rejecting changes nothing public.</b> The owner keeps their staged edit
 * and the note, so they open their own text with the objection attached rather than the live version
 * with their work apparently lost.
 */
export default async function ListingChangesPage({ searchParams }: Props) {
  const { status, listing, decided } = await searchParams;
  const wanted = TABS.some((tab) => tab.value === status) ? status! : "pending_review";
  const listingId = listing && /^\d{1,15}$/.test(listing) ? Number(listing) : null;

  const [queue, me, comparison] = await Promise.all([
    listListingChanges(wanted),
    getAdminProfile(),
    listingId === null ? Promise.resolve(null) : getListingChanges(listingId),
  ]);

  const title = (
    <PageTitle
      title="Listing changes"
      breadcrumb={[{ label: "Moderation" }, { label: "Listing changes" }]}
    />
  );

  // The API refuses every call anyway; this only avoids showing a screen that would bounce.
  if (me.ok && !me.data.permissions.includes(PERMISSION_REVIEW_CHANGES)) {
    return (
      <>
        {title}
        <div className="alert alert-light border">
          Your account cannot review listings. Ask a super admin for the &quot;Review and approve
          listings&quot; permission.
        </div>
      </>
    );
  }

  return (
    <>
      {title}

      {decided ? (
        <div role="status" className="alert alert-success">
          {decided === "approved"
            ? "Published. The live listing now shows the owner's changes."
            : "Sent back to the owner. The live listing is unchanged."}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- one edit, side by side */}
      {listingId !== null ? (
        <div className="row g-3 mb-4">
          <div className="col-12">
            <div className="card mb-0">
              <div className="card-body">
                {comparison === null || !comparison.ok ? (
                  <div role="alert" className="alert alert-danger mb-0">
                    {comparison?.status === 404
                      ? "There are no changes waiting on that listing."
                      : (comparison?.message ?? "We could not load those changes.")}
                  </div>
                ) : (
                  <>
                    <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
                      <div>
                        <h4 className="card-title mb-1">{comparison.data.listingName}</h4>
                        <p className="card-title-desc mb-0">
                          {comparison.data.status === "pending_review"
                            ? `Submitted ${formatWhen(comparison.data.submittedAt)}`
                            : comparison.data.status === "rejected"
                              ? "Sent back to the owner, and not resubmitted yet"
                              : "Saved by the owner and not submitted"}
                          {comparison.data.url ? (
                            <>
                              {" "}
                              &middot;{" "}
                              <a
                                href={comparison.data.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-decoration-underline"
                              >
                                see the live page
                              </a>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <span
                        className={`badge ${
                          comparison.data.status === "pending_review"
                            ? "bg-warning-subtle text-warning"
                            : comparison.data.status === "rejected"
                              ? "bg-danger-subtle text-danger"
                              : "bg-secondary-subtle text-secondary"
                        }`}
                      >
                        {comparison.data.status.replace("_", " ")}
                      </span>
                    </div>

                    {comparison.data.reviewNote ? (
                      <p className="alert alert-light border mt-3 mb-0 font-size-13">
                        <span className="fw-semibold">Last note to the owner:</span>{" "}
                        {comparison.data.reviewNote}
                      </p>
                    ) : null}

                    <div className="table-responsive mt-3">
                      <table className="table align-middle mb-0">
                        <thead className="table-light">
                          <tr>
                            <th scope="col" style={{ width: "10rem" }}>
                              Field
                            </th>
                            <th scope="col">On the site now</th>
                            <th scope="col">Proposed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparison.data.fields.map((field) => (
                            <tr key={field.field} className={field.changed ? "table-warning" : undefined}>
                              <th scope="row" className="fw-semibold">
                                {field.label}
                                {field.changed ? (
                                  <span className="d-block text-warning font-size-11">changed</span>
                                ) : null}
                              </th>
                              {/* Unchanged rows are kept rather than hidden: a moderator deciding
                                  whether a new description fits the business needs to see the
                                  business, and an address four rows up is part of that. */}
                              <td className="text-muted" style={{ whiteSpace: "pre-wrap" }}>
                                {field.current?.trim() || <span className="fst-italic">empty</span>}
                              </td>
                              <td
                                className={field.changed ? "fw-semibold" : "text-muted"}
                                style={{ whiteSpace: "pre-wrap" }}
                              >
                                {field.proposed?.trim() || <span className="fst-italic">empty</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {comparison.data.status === "draft" ? (
                      <p className="alert alert-light border mt-3 mb-0 font-size-13">
                        The owner has not submitted these changes. There is nothing to decide yet —
                        they are shown here so a question about a listing can be answered.
                      </p>
                    ) : (
                      <ChangeDecision
                        listingId={comparison.data.listingId}
                        listingUrl={comparison.data.url}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- the queue */}
      <div className="row g-3">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Waiting</h4>
              <p className="card-title-desc mb-3">
                Oldest first. Every listing here is on the site and stays exactly as it is until a
                change is approved.
              </p>

              <FilterTabs
                tabs={TABS}
                current={wanted}
                hrefFor={(value) => `/admin/listing-changes?status=${value}`}
                label="Filter staged changes"
              />

              {!queue.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {queue.message}
                </div>
              ) : queue.data.length === 0 ? (
                <EmptyState icon="bx bx-check-double" title="Nothing waiting">
                  No owner has changes in this state.
                </EmptyState>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col">Listing</th>
                        <th scope="col">State</th>
                        <th scope="col" className="text-end">
                          Fields changed
                        </th>
                        <th scope="col">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queue.data.map((item) => (
                        <tr key={item.listingId}>
                          <td className="py-3">
                            <Link
                              href={`/admin/listing-changes?status=${wanted}&listing=${item.listingId}`}
                              className="fw-semibold text-body"
                            >
                              {item.listingName}
                            </Link>
                            <span className="d-block text-muted font-size-12">
                              {item.localityName} &middot; listing is {item.listingStatus}
                            </span>
                          </td>
                          <td className="py-3">
                            <span
                              className={`badge ${
                                item.status === "pending_review"
                                  ? "bg-warning-subtle text-warning"
                                  : item.status === "rejected"
                                    ? "bg-danger-subtle text-danger"
                                    : "bg-secondary-subtle text-secondary"
                              }`}
                            >
                              {item.status.replace("_", " ")}
                            </span>
                          </td>
                          <td className="py-3 text-end">{item.fieldsChanged}</td>
                          <td className="py-3 text-muted font-size-13 text-nowrap">
                            {formatWhen(item.submittedAt ?? item.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
