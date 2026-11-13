import type { Metadata } from "next";
import { Pagination } from "@/components/Pagination";
import { EmptyState, FilterTabs } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_REPORTS,
  REVIEW_STATUSES,
  formatWhen,
  getAdminProfile,
  getReviewQueue,
} from "@/lib/admin-api";
import { ReviewDecision } from "./ReviewDecision";

export const metadata: Metadata = { title: "Review moderation" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ status?: string; page?: string; decided?: string }> };

/** The reviewer's number is masked: a moderator needs to tell people apart, not to ring them up. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}${"*".repeat(phone.length - 7)}${phone.slice(-4)}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  approved: "Published",
  rejected: "Rejected",
};

/**
 * The review queue, on the original's Minia layout.
 *
 * A review is a paragraph of prose with a decision attached, so it stays a list of blocks rather
 * than becoming a table — a table would either clip the text or make the rows unreadably tall. The
 * blocks are the theme's own bordered panels, and the whole queue sits in one card the way the
 * original's moderation screens do.
 */
export default async function ReviewModerationPage({ searchParams }: Props) {
  const { status: rawStatus, page: rawPage, decided } = await searchParams;

  // Anything unknown falls back to the queue that matters; the API validates the value again.
  const status = REVIEW_STATUSES.includes(rawStatus as (typeof REVIEW_STATUSES)[number]) ? rawStatus! : "pending";
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [result, me] = await Promise.all([getReviewQueue(status, page), getAdminProfile()]);
  const mayModerate = me.ok && me.data.permissions.includes(PERMISSION_REPORTS);

  return (
    <>
      <PageTitle title="Reviews" breadcrumb={[{ label: "Listings" }, { label: STATUS_LABEL[status] ?? "Reviews" }]} />

      <div className="row mb-3">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-1">Review moderation</h4>
              <p className="card-title-desc mb-3">
                Customers write reviews from a listing page. Nothing appears on the site until
                someone approves it here.
              </p>

              <FilterTabs
                tabs={REVIEW_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] ?? value }))}
                current={status}
                hrefFor={(value) => `/admin/reviews?status=${value}`}
              />

              {decided ? (
                <div role="status" className="alert alert-success">
                  {decided === "approved"
                    ? "Review approved. It is on the listing page now."
                    : "Review rejected. The reviewer can see your reason."}
                </div>
              ) : null}

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.status === 403
                    ? "Your account does not have permission to moderate reviews."
                    : result.message}
                </div>
              ) : result.data.items.length === 0 ? (
                <EmptyState
                  icon="bx bx-star"
                  title={
                    status === "pending"
                      ? "Nothing is waiting for review"
                      : `No ${STATUS_LABEL[status]!.toLowerCase()} reviews`
                  }
                >
                  {result.data.total > 0
                    ? "That page is past the end of the list."
                    : status === "pending"
                      ? "New reviews appear here as soon as a customer writes one."
                      : "Try another status."}
                </EmptyState>
              ) : (
                <>
                  <p className="text-muted font-size-13">
                    {result.data.total} {result.data.total === 1 ? "review" : "reviews"}
                  </p>

                  {/*
                    Three levels, in the order a moderator reads them: which listing this is about,
                    who wrote it and when, then the review itself. The listing name carries the
                    weight; the byline is muted and small; the body sits at normal size with room
                    to breathe, because it is the thing being judged.
                  */}
                  {result.data.items.map((review) => (
                    <div key={review.id} className="border rounded p-4 mb-3">
                      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
                        <div className="min-w-0">
                          <h5 className="font-size-16 mb-1">{review.listingName}</h5>
                          <p className="text-muted font-size-12 mb-0">
                            {maskPhone(review.reviewerPhone)} &middot; {formatWhen(review.createdAt)}
                          </p>
                        </div>
                        <span
                          aria-label={`${review.rating} out of 5`}
                          className="badge bg-primary-subtle text-primary font-size-13 flex-shrink-0"
                        >
                          {review.rating} / 5
                        </span>
                      </div>

                      <p className="mt-3 mb-0 lh-base" style={{ whiteSpace: "pre-line" }}>
                        {review.body}
                      </p>

                      {status === "pending" && mayModerate ? <ReviewDecision reviewId={review.id} /> : null}
                      {status === "pending" && !mayModerate ? (
                        <p className="text-muted font-size-13 border-top mt-4 pt-3 mb-0">
                          Your account can see this queue but not decide on it.
                        </p>
                      ) : null}
                    </div>
                  ))}

                  <Pagination
                    page={result.data.page}
                    totalPages={result.data.totalPages}
                    params={{ status }}
                    basePath="/admin/reviews"
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
