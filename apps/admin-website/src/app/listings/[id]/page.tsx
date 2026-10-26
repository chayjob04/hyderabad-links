import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { PERMISSION_EDIT, PERMISSION_REVIEW, formatWhen, getAdminProfile, getListing } from "@/lib/admin-api";
import { DecisionForm } from "./DecisionForm";
import { LiveStatusForm } from "./LiveStatusForm";

export const metadata: Metadata = { title: "Review listing" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string; live?: string }> };

/** One labelled fact about the listing. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-t border-neutral-100 py-2 first:border-t-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-900">{value && value.trim() !== "" ? value : "—"}</dd>
    </div>
  );
}

export default async function ReviewListingPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { added, live } = await searchParams;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isSafeInteger(id) || id < 1) notFound();

  const [result, me] = await Promise.all([getListing(id), getAdminProfile()]);

  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto max-w-3xl px-4 pt-8">
        <h1 className="text-2xl font-bold">Listing</h1>
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      </main>
    );
  }

  const listing = result.data;
  const mapsLink = `https://www.google.com/maps?q=${listing.latitude},${listing.longitude}`;
  // The API enforces this; the page only avoids showing a form that would be refused.
  const mayReview = me.ok && me.data.permissions.includes(PERMISSION_REVIEW);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_EDIT);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <Link href="/listings" className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline">
        &larr; Back to the queue
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{listing.name}</h1>
          <p className="mt-1 text-neutral-600">
            {listing.categoryName ?? "No category"} &middot; {listing.localityName}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {mayEdit ? (
            <Link
              href={`/listings/${listing.id}/edit`}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
            >
              Edit
            </Link>
          ) : null}
          <StatusBadge status={listing.status} />
        </div>
      </div>

      {added ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
          {listing.status === "active"
            ? "Listing added and published. It is on the public site now."
            : "Listing added. It is in the review queue, waiting for someone who can publish it."}
        </p>
      ) : null}

      {live ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
          {live === "suspended"
            ? "Listing suspended. It is off the public site and the owner can see why."
            : "Listing put back. It is on the public site again."}
        </p>
      ) : null}

      {listing.reviewNote ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Last rejection reason:</span> {listing.reviewNote}
        </p>
      ) : null}

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <dl className="rounded-xl border border-neutral-200 bg-white px-4 py-2 shadow-sm">
          <Field label="Description" value={listing.description} />
          <Field label="Address" value={listing.addressLine} />
          <Field label="Pincode" value={listing.pincode} />
          <Field label="Phone" value={listing.phonePrimary} />
          <Field label="WhatsApp" value={listing.phoneWhatsapp} />
          <Field label="Email" value={listing.email} />
          <Field label="Website" value={listing.websiteUrl} />
        </dl>

        <dl className="rounded-xl border border-neutral-200 bg-white px-4 py-2 shadow-sm">
          {/* The plan, from the entitlement view: "Verified until …" while a period is running,
              and plain "Free" once it is not. Worth knowing before suspending a business that is
              paying for the page you are about to take down. */}
          <Field
            label="Plan"
            value={
              listing.isVerified
                ? `Verified${listing.paidUntil ? ` until ${formatWhen(listing.paidUntil)}` : ""}`
                : "Free"
            }
          />
          <Field label="Submitted by" value={listing.submittedByPhone} />
          <Field label="Created" value={formatWhen(listing.createdAt)} />
          <Field label="Last change" value={formatWhen(listing.updatedAt)} />
          <Field label="First published" value={formatWhen(listing.publishedAt)} />
          <Field
            label="Last decision"
            value={listing.reviewedAt ? `${formatWhen(listing.reviewedAt)} by ${listing.reviewedBy ?? "an admin"}` : null}
          />
          <Field label="Map point" value={`${listing.latitude.toFixed(5)}, ${listing.longitude.toFixed(5)}`} />
          <div className="border-t border-neutral-100 py-2">
            <a
              href={mapsLink}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              Open the map point
            </a>
            {listing.status === "active" && listing.url ? (
              <>
                {" · "}
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
                >
                  Public page
                </a>
              </>
            ) : null}
          </div>
        </dl>
      </section>

      <div className="mt-6">
        {listing.status === "active" || listing.status === "suspended" ? (
          mayReview ? (
            <LiveStatusForm listingId={listing.id} suspended={listing.status === "suspended"} />
          ) : (
            <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
              Your account can view listings but not take them off the site.
            </p>
          )
        ) : listing.status !== "pending_review" ? (
          <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
            This listing is not waiting for review, so there is nothing to decide. Owners can submit a draft or
            rejected listing again themselves.
          </p>
        ) : mayReview ? (
          <DecisionForm listingId={listing.id} />
        ) : (
          <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
            Your account can view listings but not approve or reject them. Ask a super admin for the
            &quot;Approve or reject listings&quot; permission.
          </p>
        )}
      </div>
    </main>
  );
}
