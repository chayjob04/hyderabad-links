import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { PageTitle } from "@/components/minia/PageTitle";
import { StatCard } from "@/components/minia/StatCard";
import {
  PERMISSION_LISTINGS_EDIT,
  describeStatus,
  getCategoryCounts,
  getProfile,
  listListingsInCategory,
} from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Category" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

const TONES: Record<string, string> = {
  grey: "bg-secondary-subtle text-secondary",
  amber: "bg-warning-subtle text-warning",
  green: "bg-success-subtle text-success",
  red: "bg-danger-subtle text-danger",
};

/**
 * One category: its subcategories with counts, and anything filed directly on the category itself
 * — the original's `Super/ListingsByCategory/ViewByCategory`.
 *
 * The listing table here is deliberately short. Listings are filed under subcategories, so the
 * rows on a parent category are the odd ones out: a handful filed at the wrong level, usually by
 * an import. Seeing them is the point — the full list for a subcategory is one click further on.
 */
export default async function CategoryDrillPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { page: rawPage } = await searchParams;
  const page = Number.parseInt(rawPage ?? "1", 10);

  const [counts, listings, me] = await Promise.all([
    getCategoryCounts(),
    listListingsInCategory(slug, Number.isSafeInteger(page) && page > 0 ? page : 1),
    getProfile(),
  ]);

  const mayView = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);
  if (me.ok && !mayView) {
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="listings by category" />;
  }

  if (!counts.ok) {
    return (
      <>
        <PageTitle title="Category" breadcrumb={[{ label: "Listings" }, { label: "By category" }]} />
        <div role="alert" className="alert alert-danger">
          {counts.message}
        </div>
      </>
    );
  }

  const category = counts.data.find((row) => row.slug === slug && row.level === 1);
  if (!category) notFound();

  const children = counts.data
    .filter((row) => row.parentSlug === slug)
    .sort((a, b) => b.activeCount - a.activeCount);

  const liveTotal =
    category.activeCount + children.reduce((sum, child) => sum + child.activeCount, 0);
  const allTotal = category.totalCount + children.reduce((sum, child) => sum + child.totalCount, 0);

  return (
    <>
      <PageTitle
        title={category.name}
        breadcrumb={[
          { label: "By category", href: "/super-admin/listings/by-category" },
          { label: category.name },
        ]}
        action={
          <Link href="/super-admin/listings/by-category" className="btn btn-outline-secondary">
            <i className="mdi mdi-arrow-left me-1" /> All categories
          </Link>
        }
      />

      <div className="row g-3 mb-4">
        <StatCard label="Live listings" value={liveTotal} />
        <StatCard label="All statuses" value={allTotal} />
        <StatCard label="Subcategories" value={children.length} />
        <StatCard label="Filed on the category" value={category.totalCount} />
      </div>

      <div className="row g-3">
        <div className="col-xl-7">
          <div className="card h-100">
            <div className="card-body">
              <h4 className="card-title mb-1">Subcategories</h4>
              <p className="card-title-desc mb-3">
                Busiest first. A subcategory with nothing live is a page that leads nowhere.
              </p>

              {children.length === 0 ? (
                <div className="alert alert-light border mb-0 font-size-13">
                  This category has no subcategories. Add one under Categories on the admin site
                  before filing listings here.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col">Subcategory</th>
                        <th scope="col" className="text-end">
                          Live
                        </th>
                        <th scope="col" className="text-end">
                          All statuses
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {children.map((child) => (
                        <tr key={child.slug} className={child.activeCount === 0 ? "table-warning" : undefined}>
                          <td className="py-3">
                            <Link
                              href={`/super-admin/listings/by-subcategory/${child.slug}`}
                              className="fw-semibold text-body"
                            >
                              {child.name}
                            </Link>
                            {!child.isActive ? (
                              <span className="badge bg-warning-subtle text-warning ms-2">Retired</span>
                            ) : null}
                          </td>
                          <td className="py-3 text-end">{child.activeCount}</td>
                          <td className="py-3 text-end text-muted">{child.totalCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-xl-5">
          <div className="card h-100">
            <div className="card-body">
              <h4 className="card-title mb-1">Filed directly on {category.name}</h4>
              <p className="card-title-desc mb-3">
                These sit on the category itself rather than a subcategory, so they do not appear on
                any subcategory page. Usually worth moving.
              </p>

              {!listings.ok || listings.data.items.length === 0 ? (
                <p className="text-muted font-size-13 mb-0">
                  Nothing is filed at this level, which is how it should be.
                </p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col">Listing</th>
                        <th scope="col">Area</th>
                        <th scope="col" className="text-center">
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
                              <Link
                                href={`/super-admin/listings/${listing.id}`}
                                className="fw-semibold text-body"
                              >
                                {listing.name}
                              </Link>
                            </td>
                            <td className="py-3 text-muted">{listing.localityName}</td>
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
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
