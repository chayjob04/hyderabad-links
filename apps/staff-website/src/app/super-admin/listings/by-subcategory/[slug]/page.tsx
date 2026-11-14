import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { Pagination } from "@/components/Pagination";
import { PageTitle } from "@/components/minia/PageTitle";
import { StatCard } from "@/components/minia/StatCard";
import {
  PERMISSION_LISTINGS_EDIT,
  describeStatus,
  formatWhen,
  getCategoryCounts,
  getProfile,
  listListingsInCategory,
} from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Subcategory" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

const TONES: Record<string, string> = {
  grey: "bg-secondary-subtle text-secondary",
  amber: "bg-warning-subtle text-warning",
  green: "bg-success-subtle text-success",
  red: "bg-danger-subtle text-danger",
};

/**
 * Everything filed under one subcategory — the original's
 * `Super/ListingsByCategory/ViewBySubCategory`.
 *
 * All statuses, not only the live ones. A subcategory that looks empty on the public site but holds
 * nine listings awaiting review is a queue problem, not a content problem, and the two need telling
 * apart before anybody goes looking for businesses to add.
 */
export default async function SubcategoryDrillPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { page: rawPage } = await searchParams;
  const page = Number.parseInt(rawPage ?? "1", 10);
  const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1;

  const [counts, listings, me] = await Promise.all([
    getCategoryCounts(),
    listListingsInCategory(slug, currentPage),
    getProfile(),
  ]);

  const mayView = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);
  if (me.ok && !mayView) {
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="listings by subcategory" />;
  }

  if (!counts.ok) {
    return (
      <>
        <PageTitle title="Subcategory" breadcrumb={[{ label: "Listings" }, { label: "By subcategory" }]} />
        <div role="alert" className="alert alert-danger">
          {counts.message}
        </div>
      </>
    );
  }

  const subcategory = counts.data.find((row) => row.slug === slug && row.level === 2);
  if (!subcategory) notFound();

  return (
    <>
      <PageTitle
        title={subcategory.name}
        breadcrumb={[
          { label: "By subcategory", href: "/super-admin/listings/by-subcategory" },
          { label: subcategory.name },
        ]}
        action={
          <Link href="/super-admin/listings/by-subcategory" className="btn btn-outline-secondary">
            <i className="mdi mdi-arrow-left me-1" /> All subcategories
          </Link>
        }
      />

      <div className="row g-3 mb-4">
        <StatCard label="Live" value={subcategory.activeCount} />
        <StatCard label="All statuses" value={subcategory.totalCount} />
        <StatCard
          label="Not live"
          value={subcategory.totalCount - subcategory.activeCount}
        />
        <StatCard label="Parent category" value={subcategory.parentName ?? "—"} />
      </div>

      <div className="row g-3">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Listings</h4>
              <p className="card-title-desc mb-3">
                Every status, not only the live ones.
                {subcategory.parentName ? (
                  <>
                    {" "}
                    In{" "}
                    <Link href={`/super-admin/listings/by-category/${subcategory.parentSlug}`}>
                      {subcategory.parentName}
                    </Link>
                    .
                  </>
                ) : null}
              </p>

              {!listings.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {listings.message}
                </div>
              ) : listings.data.items.length === 0 ? (
                <div className="alert alert-warning mb-0">
                  Nothing is filed under this subcategory. It is a live page on the public site that
                  returns no results.
                </div>
              ) : (
                <>
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Listing</th>
                          <th scope="col">Area</th>
                          <th scope="col">Added</th>
                          <th scope="col" className="text-center" style={{ width: "10rem" }}>
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {listings.data.items.map((listing) => {
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
                              <td className="py-3 text-muted">{listing.localityName}</td>
                              <td className="py-3 text-muted font-size-13 text-nowrap">
                                {formatWhen(listing.createdAt)}
                              </td>
                              <td className="py-3 text-center">
                                <span className={`badge ${TONES[tone.tone] ?? TONES.grey}`}>
                                  {tone.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    page={listings.data.page}
                    totalPages={listings.data.totalPages}
                    params={{}}
                    basePath={`/super-admin/listings/by-subcategory/${slug}`}
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
