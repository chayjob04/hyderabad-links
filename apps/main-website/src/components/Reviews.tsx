import Link from "next/link";
import { ReviewComposer } from "@/components/ReviewComposer";
import type { PublicReview, ReviewSummary } from "@/lib/types";

/**
 * The reviews a visitor sees on a business page: the average, then the approved reviews.
 *
 * Nothing here is generated or estimated. Until a moderator approves something there is no average
 * and no list, and the section says so rather than showing an empty five stars.
 */

/** Filled stars up to the rating. Decorative: the number beside it is the accessible value. */
function Stars({ rating }: { rating: number }) {
  return (
    <span aria-hidden="true" className="text-brand-700">
      {"★".repeat(Math.round(rating))}
      <span className="text-brand-200">{"★".repeat(5 - Math.round(rating))}</span>
    </span>
  );
}

function ReviewItem({ review }: { review: PublicReview }) {
  return (
    <li className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-black text-ink">{review.authorName}</p>
        <p className="text-sm">
          <Stars rating={review.rating} />
          <span className="ml-2 font-bold text-muted">{review.rating} out of 5</span>
        </p>
      </div>
      <p className="mt-2 leading-relaxed text-ink whitespace-pre-line">{review.body}</p>
      <p className="mt-1.5 text-xs text-muted">
        <time dateTime={review.createdAt}>
          {new Date(review.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
        </time>
      </p>
    </li>
  );
}

export function Reviews({
  summary,
  businessName,
  signedIn,
  writeHref,
  children,
}: {
  summary: ReviewSummary;
  businessName: string;
  /** Whether this visitor can write one now, or needs to sign in first. */
  signedIn: boolean;
  writeHref: string;
  /** The form, rendered by the page so this component stays a server component. */
  children?: React.ReactNode;
}) {
  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="mt-10 rounded-2xl border border-line bg-white p-6 shadow-[0_8px_28px_#002a3412] sm:p-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="reviews-heading" className="text-xl font-black text-ink">
          Reviews
        </h2>
        {summary.average !== null ? (
          <p className="text-sm">
            <Stars rating={summary.average} />
            <span className="ml-2 font-black text-ink">{summary.average.toFixed(1)}</span>
            <span className="ml-1 font-bold text-muted">
              from {summary.count} {summary.count === 1 ? "review" : "reviews"}
            </span>
          </p>
        ) : null}
      </div>

      {summary.count === 0 ? (
        <p className="mt-3 text-muted">
          No reviews yet. If you have used {businessName}, yours would be the first.
        </p>
      ) : (
        <ul className="mt-5 grid gap-4">
          {summary.items.map((review) => (
            <ReviewItem key={review.id} review={review} />
          ))}
        </ul>
      )}

      <div className="mt-6 border-t border-line pt-5">
        {signedIn ? (
          // Behind a button: most people on this page are reading reviews, not writing one.
          <ReviewComposer>{children}</ReviewComposer>
        ) : (
          <p className="text-sm text-muted">
            <Link href={writeHref} className="font-black text-brand-700 hover:underline">
              Sign in to write a review
            </Link>{" "}
            &mdash; we check that every reviewer has a verified mobile number, and a moderator reads
            each review before it appears.
          </p>
        )}
      </div>
    </section>
  );
}
