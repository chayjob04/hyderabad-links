import { ListingNav } from "@/components/account/ListingNav";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { getMyListing, getOpeningHours } from "@/lib/owner-api";
import { HoursForm } from "./HoursForm";

export const metadata: Metadata = { title: "Opening hours" };

type Props = { params: Promise<{ id: string }> };

/**
 * The owner's opening hours for one listing.
 *
 * Available on every plan. This is the single most asked question about a local business, and
 * putting it behind the paid tier would make the directory worse for the visitor — who is not the
 * one paying — in exchange for very little.
 */
export default async function ListingHoursPage({ params }: Props) {
  const { id: rawId } = await params;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listingResult, hoursResult] = await Promise.all([getMyListing(id), getOpeningHours(id)]);
  if (!listingResult.ok) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="border-b border-line pb-5">
        <Link href="/account/listings" className="text-sm font-bold text-brand-700 hover:underline">
          <span aria-hidden="true">&larr;</span> My listings
        </Link>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-brand-800">Opening hours</h1>
        <p className="mt-2 text-sm text-muted">{listingResult.data.name}</p>
        <ListingNav listingId={id} current="hours" />
      </div>

      <div className="mt-6">
        {hoursResult.ok ? (
          <HoursForm listingId={id} initial={hoursResult.data.intervals} />
        ) : (
          <EmptyState tone="error" mark="&#9888;" title="We could not load your hours">
            <p>{hoursResult.message}</p>
          </EmptyState>
        )}
      </div>

      <p className="mt-5 text-sm text-muted">
        Your listing shows <strong>Open now</strong> or <strong>Closed</strong> based on these, in
        Hyderabad time, so visitors anywhere see the same answer.
      </p>
    </main>
  );
}
