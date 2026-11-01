import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { getMyListing } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Business added" };

type Props = { params: Promise<{ id: string }> };

/** One thing to do next: where it goes, why it is worth doing, and whether a plan is needed. */
const NEXT_STEPS: { label: string; detail: string; path: string; paid?: boolean }[] = [
  {
    label: "Finish the details",
    detail: "The address and a description are what a visitor reads first, and both are needed before review.",
    path: "edit",
  },
  {
    label: "Set your opening hours",
    detail: "A listing with hours can say “Open now” on its page and in results.",
    path: "hours",
  },
  {
    label: "Add photos and a logo",
    detail: "Included with the Verified plan. People choose a business they can see.",
    path: "photos",
    paid: true,
  },
  {
    label: "Answer common questions",
    detail: "Parking, delivery, languages spoken — the questions you already answer on the phone.",
    path: "about",
  },
  {
    label: "Add your website and socials",
    detail: "Included with the Verified plan.",
    path: "links",
    paid: true,
  },
];

/**
 * The confirmation after a business is added — the original's `AddListing/Success`.
 *
 * It exists because the redirect it replaced dropped someone straight back into the same form they
 * had just filled in, with a one-line banner above it. Nothing told them the draft was private,
 * that review was a separate step they had to ask for, or what else was worth adding. This page
 * says all three, and every row links to the screen that does it.
 */
export default async function ListingCreatedPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const result = await getMyListing(id);
  if (!result.ok) {
    if (result.status === 404) notFound(); // also what another owner's listing looks like
    return (
      <main className="mx-auto max-w-2xl px-5 py-10 sm:px-8">
        <EmptyState tone="error" mark="&#9888;" title="We could not load this listing">
          <p>{result.message}</p>
        </EmptyState>
      </main>
    );
  }

  const listing = result.data;

  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:px-8">
      <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center sm:p-8">
        <p aria-hidden="true" className="text-4xl leading-none text-green-700">
          &#10003;
        </p>
        <h1 className="mt-3 text-2xl leading-tight font-black tracking-tight text-green-900 sm:text-3xl">
          {listing.name} is saved
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-green-900">
          It is a private draft for now. Nobody else can see it, and it stays that way until you
          send it for review and our team approves it.
        </p>
      </div>

      <h2 className="mt-9 text-lg font-black text-brand-800">What to do next</h2>
      <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-white">
        {NEXT_STEPS.map((step) => (
          <li key={step.path} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="font-black text-ink">
                {step.label}
                {step.paid ? (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black tracking-wider text-amber-900 align-middle">
                    VERIFIED
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-sm text-muted">{step.detail}</p>
            </div>
            <Link
              href={`/account/listings/${id}/${step.path}`}
              className="shrink-0 text-sm font-black text-brand-700 hover:underline"
            >
              Open <span aria-hidden="true">&rarr;</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={`/account/listings/${id}/edit`}
          className="rounded-full bg-brand-700 px-5 py-2.5 text-sm font-black text-white hover:bg-brand-800"
        >
          Finish the details
        </Link>
        <Link
          href={`/account/listings/${id}/preview`}
          className="rounded-full border border-brand-200 px-5 py-2.5 text-sm font-black text-brand-700 hover:border-brand-700 hover:bg-brand-50"
        >
          See what is filled in
        </Link>
        <Link
          href="/account/listings"
          className="rounded-full border border-line px-5 py-2.5 text-sm font-black text-muted hover:border-brand-200 hover:text-brand-700"
        >
          My listings
        </Link>
      </div>
    </main>
  );
}
