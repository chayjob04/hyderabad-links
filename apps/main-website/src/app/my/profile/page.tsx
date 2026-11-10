import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCustomer, listMyReviews } from "@/lib/customer-api";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = { title: "Profile" };

/**
 * The customer's own details, and the reviews they have written.
 *
 * There is nothing here about businesses, listings or plans. This account owns none of them: a
 * business is a separate account on a separate sign-in, which "List your business" leads to.
 */
export default async function CustomerProfilePage() {
  const [me, reviews] = await Promise.all([getCustomer(), listMyReviews()]);

  return (
    <>
      <h1 className="text-2xl font-black text-ink">Profile</h1>
      <p className="mt-1 text-muted">Your contact details, and the reviews you have written.</p>

      <section aria-labelledby="your-details" className="mt-7">
        <h2 id="your-details" className="text-lg font-black text-ink">
          Your details
        </h2>
        <div className="mt-4 rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]">
          {me.ok ? (
            <>
              <p className="mb-5 text-sm text-muted">
                You sign in with a one-time code sent to{" "}
                <span className="font-bold text-brand-800">{me.data.phone}</span>. There is no
                password to remember or lose.
              </p>
              <ProfileForm name={me.data.name ?? ""} email={me.data.email ?? ""} />
            </>
          ) : (
            <EmptyState mark="!" title="We could not load your details" tone="error">
              <p>{me.message}</p>
            </EmptyState>
          )}
        </div>
      </section>

      <section aria-labelledby="your-reviews" className="mt-9">
        <h2 id="your-reviews" className="text-lg font-black text-ink">
          Your reviews
        </h2>

        {!reviews.ok ? (
          <div className="mt-4">
            <EmptyState mark="!" title="We could not load your reviews" tone="error">
              <p>{reviews.message}</p>
            </EmptyState>
          </div>
        ) : reviews.data.length === 0 ? (
          <div className="mt-4">
            <EmptyState mark="&#9734;" title="You have not written a review yet">
              <p>Open a business you have used and tell other people what it was like.</p>
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {reviews.data.map((review) => (
              <li
                key={review.id}
                className="rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="text-lg font-black text-ink">
                    <Link href={review.url} className="hover:text-brand-700">
                      {review.listingName}
                    </Link>
                  </h3>
                  <p aria-label={`${review.rating} out of 5`} className="font-black text-brand-700">
                    {review.rating}/5
                  </p>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{review.body}</p>
                {review.status !== "approved" ? (
                  <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
                    {review.status === "pending"
                      ? "Waiting for a moderator. It is not on the site yet."
                      : `Not published. ${review.moderationNote ?? ""}`}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
