import type { Metadata } from "next";
import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/brand";

export const metadata: Metadata = {
  title: "No access",
  robots: { index: false, follow: false },
};

/**
 * The owner-side refusal — the original's `Account/AccessDenied`.
 *
 * Worth being clear about what this page is *not* for. Opening a listing that belongs to somebody
 * else answers 404, on purpose: whether a particular business is registered here is not something
 * a stranger gets to learn by trying ids, and a "not allowed" answer would confirm it. That stays.
 *
 * This page is for the other case — the account is signed in and the listing is theirs, but the
 * account itself cannot act: a suspended owner, or a screen that needs a verified mobile the
 * account has not completed. The message therefore explains the account, not the listing, and
 * gives a way to ask a person.
 */
export default function OwnerAccessDeniedPage() {
  return (
    <main className="mx-auto max-w-xl px-5 py-16 sm:px-8">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-7 text-center">
        <p aria-hidden="true" className="text-4xl leading-none text-amber-700">
          &#9888;
        </p>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-amber-900">
          Your account cannot open this
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-amber-900">
          You are signed in, but this part of your dashboard is not available to your account right
          now. If you think that is wrong, write to us and a person will look at it.
        </p>
        <p className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/account/listings"
            className="rounded-full bg-brand-700 px-5 py-2.5 text-sm font-black text-white hover:bg-brand-800"
          >
            My listings
          </Link>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="rounded-full border border-amber-300 px-5 py-2.5 text-sm font-black text-amber-900 hover:bg-amber-100"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    </main>
  );
}
