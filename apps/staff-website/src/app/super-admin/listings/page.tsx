import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  LISTING_STATUSES,
  PERMISSION_LISTINGS_CREATE,
  PERMISSION_LISTINGS_FEATURE,
  describeStatus,
  formatWhen,
  getProfile,
  listListings,
} from "@/lib/super-admin-api";
import { FeatureToggle } from "./FeatureToggle";

export const metadata: Metadata = { title: "Listings" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string; done?: string; error?: string }> };

/** The theme's soft badge per status tone, matching the admin site's StatusBadge. */
const TONES: Record<string, string> = {
  grey: "bg-secondary-subtle text-secondary",
  amber: "bg-warning-subtle text-warning",
  green: "bg-success-subtle text-success",
  red: "bg-danger-subtle text-danger",
};

/**
 * Every listing on the platform, on the original's Minia layout.
 *
 * A table, as the original uses for its own listing lists, with the Feature toggle in the row
 * rather than below it. Adding, correcting and removing a listing happens here; approving and
 * rejecting what owners submit happens on the admin site.
 */
export default async function ListingsPage({ searchParams }: Props) {
  const { q, status, page: rawPage, done, error } = await searchParams;
  const page = Number.parseInt(rawPage ?? "1", 10);

  /* Where the Feature toggle sends you back to: this same page, with the search, filter and page
     intact, so curating the shelf does not lose your place in a list of hundreds. */
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (rawPage) params.set("page", rawPage);
  const returnTo = params.size > 0 ? `/super-admin/listings?${params}` : "/super-admin/listings";

  const [result, me] = await Promise.all([
    listListings({ q, status, page: Number.isSafeInteger(page) && page > 0 ? page : 1 }),
    getProfile(),
  ]);

  const mayAdd = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_CREATE);
  const mayFeature = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_FEATURE);

  return (
    <>
      <PageTitle
        title="Listings"
        breadcrumb={[{ label: "Listings" }, { label: "Recent" }]}
        action={
          mayAdd ? (
            <Link href="/super-admin/listings/new" className="btn btn-primary">
              <i className="bx bx-plus align-middle me-1" /> Add a listing
            </Link>
          ) : null
        }
      />

      {done ? (
        <div role="status" className="alert alert-success">
          {done}
        </div>
      ) : null}

      {/* Featuring is refused when the shelf is full or the listing is not live, and the reason is
          worth reading rather than swallowing into a toggle that silently did not move. */}
      {error ? (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      ) : null}

      <div className="row g-3">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Every listing on the platform</h4>
              <p className="card-title-desc mb-3">
                Adding, correcting and removing one happens here; approving and rejecting what
                owners submit happens on the admin site.
              </p>

              {/* A plain GET form, so the search and the filter end up in the URL and can be shared. */}
              <form className="row g-2 align-items-end mb-3">
                <div className="col-md-5">
                  <label htmlFor="q" className="form-label">
                    Search by name
                  </label>
                  <input id="q" name="q" defaultValue={q ?? ""} placeholder="Smile Care" className="form-control" />
                </div>
                <div className="col-md-3">
                  <label htmlFor="status" className="form-label">
                    Status
                  </label>
                  <select id="status" name="status" defaultValue={status ?? ""} className="form-select">
                    <option value="">Any</option>
                    {LISTING_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {describeStatus(value).label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <button type="submit" className="btn btn-primary w-100">
                    Search
                  </button>
                </div>
              </form>

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.message}
                </div>
              ) : result.data.items.length === 0 ? (
                <EmptyState icon="bx bx-search-alt" title="No listings match that">
                  Try a different name, or clear the status filter.
                </EmptyState>
              ) : (
                <>
                  <p className="text-muted font-size-13">
                    {result.data.total} listing{result.data.total === 1 ? "" : "s"}
                  </p>

                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Listing</th>
                          <th scope="col">Category</th>
                          <th scope="col">Contact</th>
                          <th scope="col">Added</th>
                          <th scope="col" className="text-center" style={{ width: "10rem" }}>
                            Status
                          </th>
                          {mayFeature ? (
                            <th scope="col" className="text-end">
                              Featured
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.items.map((listing) => {
                          const tone = describeStatus(listing.status);
                          return (
                            <tr key={listing.id}>
                              <td className="py-3">
                                <div className="d-flex align-items-center gap-2">
                                  <Link
                                    href={`/super-admin/listings/${listing.id}`}
                                    className="fw-semibold text-body"
                                  >
                                    {listing.name}
                                  </Link>
                                  {listing.isVerified ? (
                                    <span className="badge bg-primary-subtle text-primary">Verified</span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="py-3 text-muted">
                                {listing.categoryName ?? "No category"}
                                <span className="d-block font-size-12">{listing.localityName}</span>
                              </td>
                              <td className="py-3 text-muted text-nowrap">{listing.phonePrimary}</td>
                              <td className="py-3 text-muted font-size-13 text-nowrap">
                                {formatWhen(listing.createdAt)}
                              </td>
                              <td className="py-3 text-center">
                                <span className={`badge ${TONES[tone.tone]}`}>{tone.label}</span>
                              </td>
                              {mayFeature ? (
                                <td className="py-3 text-end">
                                  <FeatureToggle
                                    listingId={listing.id}
                                    featured={listing.featuredAt !== null}
                                    live={listing.status === "active"}
                                    returnTo={returnTo}
                                  />
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    page={result.data.page}
                    totalPages={result.data.totalPages}
                    params={{ q, status }}
                    basePath="/super-admin/listings"
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
