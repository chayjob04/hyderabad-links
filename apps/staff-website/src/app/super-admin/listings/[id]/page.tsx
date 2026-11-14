import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingForm } from "@/components/ListingForm";
import { ListingStaffNav } from "@/components/ListingStaffNav";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_LISTINGS_DELETE,
  PERMISSION_LISTINGS_EDIT,
  PERMISSION_LISTINGS_FEATURE,
  describeStatus,
  formatWhen,
  getCategories,
  getListing,
  getListingAlerts,
  getProfile,
  type ListingDetail,
} from "@/lib/super-admin-api";
import { archiveListingAction, deleteListingAction, saveListingAction, setFeaturedAction } from "../actions";
import { AlertForm } from "./AlertForm";

export const metadata: Metadata = { title: "Listing" };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ added?: string; done?: string; error?: string }>;
};

const TONES: Record<string, string> = {
  grey: "bg-secondary-subtle text-secondary",
  amber: "bg-warning-subtle text-warning",
  green: "bg-success-subtle text-success",
  red: "bg-danger-subtle text-danger",
};

export default async function ListingPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { added, done, error } = await searchParams;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isSafeInteger(id) || id < 1) notFound();

  const [result, me, categories, alerts] = await Promise.all([
    getListing(id),
    getProfile(),
    getCategories(),
    getListingAlerts(id),
  ]);

  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <>
        <PageTitle title="Listing" breadcrumb={[{ label: "Listings", href: "/super-admin/listings" }]} />
        <div role="alert" className="alert alert-danger">
          {result.message}
        </div>
      </>
    );
  }

  const listing = result.data;
  const tone = describeStatus(listing.status);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);
  const mayRemove = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_DELETE);
  const mayFeature = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_FEATURE);

  return (
    <>
      <PageTitle
        title={listing.name}
        breadcrumb={[{ label: "Listings", href: "/super-admin/listings" }, { label: listing.name }]}
        action={
          <Link href="/super-admin/listings" className="btn btn-outline-secondary">
            <i className="mdi mdi-arrow-left me-1" /> Back to listings
          </Link>
        }
      />

      <ListingStaffNav listingId={listing.id} current="detail" />

      {added ? (
        <div role="status" className="alert alert-success">
          Added and published.
        </div>
      ) : null}
      {done ? (
        <div role="status" className="alert alert-success">
          {done}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      ) : null}

      <div className="row g-3 mb-4">
        {/* The edit form takes the width; the facts about the listing sit beside it rather than
            above, so correcting a detail does not mean scrolling past six read-only rows first. */}
        <div className="col-xl-7">
          <div className="card h-100">
            <div className="card-body">
              <h4 className="card-title mb-1">Correct the details</h4>
              <p className="card-title-desc mb-3">
                Editing never changes the status: one waiting for review still needs a decision, and
                a live one stays live. The area is fixed, because it is part of the public web
                address.
              </p>

              {listing.status === "archived" ? (
                <div className="alert alert-light border mb-0 font-size-13">
                  This listing is archived, so it can no longer be edited.
                </div>
              ) : mayEdit ? (
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
              ) : (
                <div className="alert alert-light border mb-0 font-size-13">
                  Your account cannot edit listings. It needs the &quot;Edit any listing&quot;
                  permission.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-xl-5">
          <div className="card mb-3">
            <div className="card-body">
              <div className="d-flex align-items-start justify-content-between gap-2 mb-3">
                <div className="min-w-0">
                  <h5 className="font-size-15 mb-1">{listing.name}</h5>
                  <p className="text-muted font-size-13 mb-0">
                    {listing.categoryName ?? "No category"} &middot; {listing.localityName}
                  </p>
                </div>
                <span className={`badge ${TONES[tone.tone] ?? TONES.grey}`}>{tone.label}</span>
              </div>

              <table className="table table-sm mb-0">
                <tbody>
                  <Fact label="Web address" value={listing.url ?? "No category, so no public page"} />
                  <Fact label="Submitted by" value={listing.submittedByPhone ?? "Added by staff"} />
                  <Fact label="Added" value={formatWhen(listing.createdAt)} />
                  <Fact label="Last changed" value={formatWhen(listing.updatedAt)} />
                  <Fact
                    label="Verified plan"
                    value={listing.isVerified ? `Paid until ${formatWhen(listing.paidUntil)}` : "Free"}
                  />
                  <Fact
                    label="Last decision"
                    value={
                      listing.reviewedBy
                        ? `${listing.reviewedBy}, ${formatWhen(listing.reviewedAt)}`
                        : "None"
                    }
                  />
                </tbody>
              </table>
            </div>
          </div>

          <FeaturedSection listing={listing} mayFeature={mayFeature} />
        </div>
      </div>

      {/* Asking the owner to fix something, and what has already been asked. Both apply whatever
          the listing's status is, so they sit outside the edit form above. */}
      <div className="row g-3 mb-4">
        <div className="col-xl-5">
          <div className="card h-100">
            <div className="card-body">
              <h4 className="card-title mb-3">Ask the owner to change something</h4>
              {mayEdit && alerts.ok ? (
                <AlertForm listingId={listing.id} reasons={alerts.data.reasons} />
              ) : (
                <p className="text-muted font-size-13 mb-0">
                  {mayEdit
                    ? "We could not load the message form. Reload the page to try again."
                    : "Your account cannot write to business owners. It needs the “Edit any listing” permission."}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="col-xl-7">
          <div className="card h-100">
            <div className="card-body">
              <h4 className="card-title mb-3">What has been asked already</h4>
              {!alerts.ok || alerts.data.items.length === 0 ? (
                <p className="text-muted font-size-13 mb-0">Nobody has written to this owner yet.</p>
              ) : (
                alerts.data.items.map((alert) => (
                  <div key={alert.id} className="border rounded p-3 mb-2">
                    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                      <span className="fw-semibold font-size-13">{alert.reasonLabel}</span>
                      <span
                        className={`badge ${
                          alert.acknowledgedAt === null
                            ? "bg-warning-subtle text-warning"
                            : "bg-secondary-subtle text-secondary"
                        }`}
                      >
                        {alert.acknowledgedAt === null ? "Not read yet" : "Read by the owner"}
                      </span>
                    </div>
                    <p className="mt-2 mb-2" style={{ whiteSpace: "pre-wrap" }}>
                      {alert.message}
                    </p>
                    <p className="text-muted font-size-12 mb-0">
                      {alert.sentByName} &middot; {formatWhen(alert.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {mayRemove ? <RemoveSection listing={listing} /> : null}
    </>
  );
}

/**
 * Whether this listing is on the homepage Featured shelf, and the one button that changes it.
 *
 * Only a live listing can be put on it — the API refuses the rest, because a card on the homepage
 * leading to a page the public cannot see is worse than an emptier shelf. The reason is said here
 * too, rather than leaving someone to discover it by pressing the button.
 */
function FeaturedSection({ listing, mayFeature }: { listing: ListingDetail; mayFeature: boolean }) {
  const featured = listing.featuredAt !== null;
  const live = listing.status === "active";

  return (
    <div className="card mb-0">
      <div className="card-body">
        <h4 className="card-title mb-1">Homepage Featured shelf</h4>
        <p className="card-title-desc mb-3">
          {featured
            ? `On the shelf since ${formatWhen(listing.featuredAt)}.`
            : "Not on the shelf. Featured is chosen by hand; Trending next to it is counted from real activity and cannot be set."}
        </p>

        {!mayFeature ? (
          <p className="text-muted font-size-13 mb-0">
            Your account cannot change it. It needs the &quot;Choose which listings appear on the
            homepage Featured shelf&quot; permission.
          </p>
        ) : !live && !featured ? (
          <p className="text-muted font-size-13 mb-0">
            Only a live listing can be featured. This one is{" "}
            {describeStatus(listing.status).label.toLowerCase()}.
          </p>
        ) : (
          <form action={setFeaturedAction.bind(null, listing.id)}>
            <button
              type="submit"
              name="intent"
              value={featured ? "unfeature" : "feature"}
              className={`btn btn-sm ${featured ? "btn-outline-secondary" : "btn-primary"}`}
            >
              <i className={`${featured ? "bx bxs-star" : "bx bx-star"} align-middle me-1`} />
              {featured ? "Take off the shelf" : "Put on the homepage"}
            </button>
          </form>
        )}

        <p className="font-size-12 mt-3 mb-0">
          <Link href="/super-admin/featured">See the whole shelf</Link>
        </p>
      </div>
    </div>
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
    <div className="row g-3">
      <div className="col-12">
        <div className="card border border-danger-subtle mb-0">
          <div className="card-body">
            <h4 className="card-title text-danger mb-3">Remove this listing</h4>

            <div className="row g-3">
              <div className="col-md-6">
                <div className="d-flex align-items-start gap-3">
                  {listing.status === "archived" ? (
                    <span className="badge bg-secondary-subtle text-secondary">Already archived</span>
                  ) : (
                    <form action={archiveListingAction.bind(null, listing.id)}>
                      {hiddenPaths}
                      <button type="submit" className="btn btn-sm btn-outline-secondary text-nowrap">
                        Archive
                      </button>
                    </form>
                  )}
                  <p className="text-muted font-size-13 mb-0">
                    Takes it off the public site and keeps everything attached to it. This is almost
                    always the one you want.
                  </p>
                </div>
              </div>

              <div className="col-md-6 border-start-md">
                <div className="d-flex align-items-start gap-3">
                  <form action={deleteListingAction.bind(null, listing.id)}>
                    {hiddenPaths}
                    <button type="submit" className="btn btn-sm btn-danger text-nowrap">
                      Delete for good
                    </button>
                  </form>
                  <p className="text-muted font-size-13 mb-0">
                    Deletes the listing and its photos, enquiries and reviews. This cannot be undone,
                    and it is refused if the business has ever paid — a payment record must not
                    disappear with a listing.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One labelled fact, as a table row: label left, value right, one line each. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th scope="row" className="fw-normal text-muted ps-0" style={{ width: "42%" }}>
        {label}
      </th>
      <td className="text-end pe-0 text-break">{value}</td>
    </tr>
  );
}
