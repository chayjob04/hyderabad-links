import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingForm } from "@/components/ListingForm";
import {
  PERMISSION_LISTINGS_DELETE,
  PERMISSION_LISTINGS_EDIT,
  describeStatus,
  formatWhen,
  getCategories,
  getListing,
  getProfile,
  type ListingDetail,
} from "@/lib/super-admin-api";
import { archiveListingAction, deleteListingAction, saveListingAction } from "../actions";

export const metadata: Metadata = { title: "Listing" };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ added?: string; done?: string; error?: string }>;
};

const TONES: Record<string, string> = {
  grey: "bg-neutral-100 text-neutral-700",
  amber: "bg-amber-50 text-amber-800",
  green: "bg-green-50 text-green-800",
  red: "bg-red-50 text-red-800",
};

export default async function ListingPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { added, done, error } = await searchParams;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isSafeInteger(id) || id < 1) notFound();

  const [result, me, categories] = await Promise.all([getListing(id), getProfile(), getCategories()]);

  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto max-w-2xl px-4 pt-8">
        <h1 className="text-2xl font-bold">Listing</h1>
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      </main>
    );
  }

  const listing = result.data;
  const tone = describeStatus(listing.status);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);
  const mayRemove = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_DELETE);

  return (
    <main className="mx-auto max-w-2xl px-4 pt-8 pb-12">
      <Link href="/listings" className="text-sm font-medium text-neutral-700 underline-offset-2 hover:underline">
        &larr; Back to listings
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{listing.name}</h1>
          <p className="mt-1 text-neutral-600">
            {listing.categoryName ?? "No category"} &middot; {listing.localityName}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone.tone]}`}>{tone.label}</span>
      </div>

      {added ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
          Added and published.
        </p>
      ) : null}
      {done ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm shadow-sm">
        <Fact label="Web address" value={listing.url ?? "No category, so no public page"} />
        <Fact label="Submitted by" value={listing.submittedByPhone ?? "Added by staff"} />
        <Fact label="Added" value={formatWhen(listing.createdAt)} />
        <Fact label="Last changed" value={formatWhen(listing.updatedAt)} />
        <Fact label="Verified plan" value={listing.isVerified ? `Paid until ${formatWhen(listing.paidUntil)}` : "Free"} />
        <Fact label="Last decision" value={listing.reviewedBy ? `${listing.reviewedBy}, ${formatWhen(listing.reviewedAt)}` : "None"} />
      </dl>

      {listing.status === "archived" ? (
        <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          This listing is archived, so it can no longer be edited.
        </p>
      ) : mayEdit ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Correct the details</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Editing never changes the status: one waiting for review still needs a decision, and a
            live one stays live. The area is fixed, because it is part of the public web address.
          </p>
          <div className="mt-4">
            <ListingForm
              action={saveListingAction.bind(null, listing.id)}
              categories={categories}
              lockedLocalityName={listing.localityName}
              initialValues={{
                name: listing.name,
                categorySlug: listing.categorySlug ?? "",
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
        </section>
      ) : (
        <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          Your account cannot edit listings. It needs the &quot;Edit any listing&quot; permission.
        </p>
      )}

      {mayRemove ? <RemoveSection listing={listing} /> : null}
    </main>
  );
}

/**
 * Archive and delete. Archive is the one to reach for: it takes the listing off the public site and
 * keeps its photos, enquiries, reviews and payment history.
 *
 * Delete removes all of that with it, so the API refuses it outright once a subscription or payment
 * exists — and says so. The page says it too, rather than letting someone find out by pressing it.
 */
function RemoveSection({ listing }: { listing: ListingDetail }) {
  // The public pages travel with the form: after a delete there is nothing left to read them from.
  const hiddenPaths = (
    <>
      <input type="hidden" name="url" value={listing.url ?? ""} />
      <input type="hidden" name="citySlug" value={listing.citySlug} />
      <input type="hidden" name="localitySlug" value={listing.localitySlug} />
      <input type="hidden" name="categorySlug" value={listing.categorySlug ?? ""} />
    </>
  );

  return (
    <section className="mt-10 rounded-xl border border-red-200 bg-red-50/40 p-4">
      <h2 className="text-lg font-semibold text-red-900">Remove this listing</h2>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {listing.status === "archived" ? (
          <p className="text-sm text-neutral-700">Already archived.</p>
        ) : (
          <form action={archiveListingAction.bind(null, listing.id)}>
            {hiddenPaths}
            <button
              type="submit"
              className="rounded-lg border border-neutral-400 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
            >
              Archive
            </button>
          </form>
        )}
        <p className="text-sm text-neutral-700">
          Takes it off the public site and keeps everything attached to it. This is almost always the
          one you want.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-red-200 pt-4">
        <form action={deleteListingAction.bind(null, listing.id)}>
          {hiddenPaths}
          <button type="submit" className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800">
            Delete for good
          </button>
        </form>
        <p className="text-sm text-neutral-700">
          Deletes the listing and its photos, enquiries and reviews. This cannot be undone, and it is
          refused if the business has ever paid — a payment record must not disappear with a listing.
        </p>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-900">{value}</dd>
    </div>
  );
}
