import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
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

export default async function ReviewModerationPage({ searchParams }: Props) {
  const { status: rawStatus, page: rawPage, decided } = await searchParams;

  // Anything unknown falls back to the queue that matters; the API validates the value again.
  const status = REVIEW_STATUSES.includes(rawStatus as (typeof REVIEW_STATUSES)[number]) ? rawStatus! : "pending";
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [result, me] = await Promise.all([getReviewQueue(status, page), getAdminProfile()]);
  const mayModerate = me.ok && me.data.permissions.includes(PERMISSION_REPORTS);

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      <h1 className="text-2xl font-bold">Reviews</h1>
      <p className="mt-1 text-neutral-600">
        Customers write reviews from a listing page. Nothing appears on the site until someone
        approves it here.
      </p>

      <nav aria-label="Filter by status" className="mt-5 flex flex-wrap gap-2">
        {REVIEW_STATUSES.map((value) => {
          const selected = value === status;
          return (
            <Link
              key={value}
              href={`/reviews?status=${value}`}
              aria-current={selected ? "page" : undefined}
              className={
                selected
                  ? "rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              }
            >
              {STATUS_LABEL[value]}
            </Link>
          );
        })}
      </nav>

      {decided ? (
        <p role="status" className="mt-5 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
          {decided === "approved"
            ? "Review approved. It is on the listing page now."
            : "Review rejected. The reviewer can see your reason."}
        </p>
      ) : null}

      {!result.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.status === 403
            ? "Your account does not have permission to moderate reviews."
            : result.message}
        </p>
      ) : result.data.items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold">
            {status === "pending" ? "Nothing is waiting for review" : `No ${STATUS_LABEL[status]!.toLowerCase()} reviews`}
          </h2>
          <p className="mt-1 text-neutral-600">
            {result.data.total > 0
              ? "That page is past the end of the list."
              : status === "pending"
                ? "New reviews appear here as soon as a customer writes one."
                : "Try another status."}
          </p>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-neutral-600">
            {result.data.total} {result.data.total === 1 ? "review" : "reviews"}
          </p>

          <ul className="mt-3 space-y-4">
            {result.data.items.map((review) => (
              <li key={review.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{review.listingName}</h2>
                    <p className="mt-0.5 text-sm text-neutral-600">
                      {maskPhone(review.reviewerPhone)} &middot; {formatWhen(review.createdAt)}
                    </p>
                  </div>
                  <span
                    aria-label={`${review.rating} out of 5`}
                    className="shrink-0 rounded-lg bg-brand-50 px-3 py-1 text-sm font-bold text-brand-900"
                  >
                    {review.rating} / 5
                  </span>
                </div>

                <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line text-neutral-800">{review.body}</p>

                {status === "pending" && mayModerate ? <ReviewDecision reviewId={review.id} /> : null}
                {status === "pending" && !mayModerate ? (
                  <p className="mt-4 border-t border-neutral-200 pt-4 text-sm text-neutral-600">
                    Your account can see this queue but not decide on it.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          <Pagination
            page={result.data.page}
            totalPages={result.data.totalPages}
            params={{ status }}
            basePath="/reviews"
          />
        </>
      )}
    </main>
  );
}
