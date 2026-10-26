import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingForm } from "@/components/ListingForm";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitForReview } from "@/components/SubmitForReview";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCategories } from "@/lib/api";
import { describeStatus, getMyListing } from "@/lib/owner-api";
import { saveListingAction } from "../../../actions";

export const metadata: Metadata = { title: "Edit listing" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

export default async function EditListingPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { created } = await searchParams;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [result, categories] = await Promise.all([getMyListing(id), getCategories()]);
  if (!result.ok) {
    if (result.status === 404) notFound(); // also what another owner's listing looks like
    return (
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <EmptyState tone="error" mark="&#9888;" title="We could not load this listing">
          <p>{result.message}</p>
        </EmptyState>
      </main>
    );
  }

  const listing = result.data;
  // Only an unfinished draft needs this: saving re-queues everything else, rejected included.
  const canSubmit = listing.status === "draft";

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <Link href="/account/listings" className="text-sm font-bold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> Back to my listings
      </Link>

      <div className="mt-4 border-b border-line pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black tracking-[0.22em] text-muted">
              {listing.categoryName.toUpperCase()} &middot; {listing.localityName.toUpperCase()}
            </p>
            <h1 className="mt-1 text-3xl leading-tight font-black tracking-tight text-brand-800">{listing.name}</h1>
          </div>
          <StatusBadge status={listing.status} />
        </div>
        <p className="mt-2 text-muted">{describeStatus(listing.status).help}</p>

        <p className="mt-2 flex flex-wrap items-center gap-4">
          <Link href={`/account/listings/${listing.id}/photos`} className="text-sm font-black text-brand-700 hover:underline">
            Photos and video <span aria-hidden="true">&rarr;</span>
          </Link>
          {/* Shown on every plan, not only the paid one: the page itself explains the allowance,
              and hiding it would leave an owner no way to find out the Verified plan includes it. */}
          <Link href={`/account/listings/${listing.id}/links`} className="text-sm font-black text-brand-700 hover:underline">
            Website and social links <span aria-hidden="true">&rarr;</span>
          </Link>
          <Link href={`/account/listings/${listing.id}/subscription`} className="text-sm font-black text-brand-700 hover:underline">
            Plan and payment <span aria-hidden="true">&rarr;</span>
          </Link>
          {listing.status === "active" ? (
            <Link href={listing.url} className="text-sm font-black text-brand-700 hover:underline">
              View public page <span aria-hidden="true">&rarr;</span>
            </Link>
          ) : null}
        </p>
      </div>

      {listing.status === "rejected" && listing.reviewNote ? (
        <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-black">What to change:</span> {listing.reviewNote}
        </p>
      ) : null}

      {created ? (
        <p
          role="status"
          className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800"
        >
          Saved. Add the address and a description, and saving again will send it for review.
        </p>
      ) : null}

      <div className="mt-6">
        <ListingForm
          action={saveListingAction.bind(null, listing.id)}
          categories={categories}
          lockedLocalityName={listing.localityName}
          initialValues={{
            name: listing.name,
            categorySlug: listing.categorySlug,
            addressLine: listing.addressLine ?? "",
            pincode: listing.pincode ?? "",
            phonePrimary: listing.phonePrimary,
            phoneWhatsapp: listing.phoneWhatsapp ?? "",
            websiteUrl: listing.websiteUrl ?? "",
            description: listing.description ?? "",
          }}
          submitLabel="Save changes"
        />
      </div>

      {canSubmit ? (
        <div className="mt-8">
          <SubmitForReview listingId={listing.id} />
        </div>
      ) : null}
    </main>
  );
}
