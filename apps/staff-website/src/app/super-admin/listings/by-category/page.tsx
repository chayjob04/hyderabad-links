import type { Metadata } from "next";
import Link from "next/link";
import { PERMISSION_LISTINGS_EDIT, getCategoryCounts, getProfile } from "@/lib/super-admin-api";
import { AccessDenied } from "@/components/AccessDenied";
import { PageTitle } from "@/components/minia/PageTitle";

export const metadata: Metadata = { title: "Listings by category" };
export const dynamic = "force-dynamic";

/**
 * How many businesses sit under each top-level category — the original's
 * `Super/ListingsByCategory/ByCategory`.
 *
 * The flat listing list cannot answer the question this one exists for: where is the directory
 * thin? A category page with two businesses on it is a page not worth arriving at, and that stays
 * invisible for as long as listings are only ever shown newest-first.
 *
 * A top-level category's count is its own plus every subcategory beneath it. Listings are filed
 * under subcategories in practice, so a parent's own count is almost always zero and showing that
 * alone would say "Food: 0" over four hundred restaurants.
 *
 * Only the primary category is counted. A listing may appear under several, but counting every
 * association would make the column add up to more than the number of listings — and the question
 * here is what somebody would find on that page.
 */
export default async function ListingsByCategoryPage() {
  const [result, me] = await Promise.all([getCategoryCounts(), getProfile()]);
  const mayView = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);

  if (me.ok && !mayView) {
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="listings by category" />;
  }

  const title = (
    <PageTitle
      title="By category"
      breadcrumb={[{ label: "Listings" }, { label: "By category" }]}
      action={
        <Link href="/super-admin/listings/by-subcategory" className="btn btn-outline-secondary">
          By subcategory <i className="mdi mdi-arrow-right ms-1" />
        </Link>
      }
    />
  );

  if (!result.ok) {
    return (
      <>
        {title}
        <div role="alert" className="alert alert-danger">
          {result.message}
        </div>
      </>
    );
  }

  const parents = result.data.filter((row) => row.level === 1);
  const children = result.data.filter((row) => row.level === 2);

  /* A parent's totals, rolled up from its children plus anything filed directly on it. Computed
     here rather than in SQL so the by-subcategory screen reads exactly the same rows. */
  const rolled = parents
    .map((parent) => {
      const mine = children.filter((child) => child.parentSlug === parent.slug);
      return {
        ...parent,
        subcategories: mine.length,
        activeCount: parent.activeCount + mine.reduce((sum, child) => sum + child.activeCount, 0),
        totalCount: parent.totalCount + mine.reduce((sum, child) => sum + child.totalCount, 0),
      };
    })
    .sort((a, b) => b.activeCount - a.activeCount);

  const liveTotal = rolled.reduce((sum, row) => sum + row.activeCount, 0);

  return (
    <>
      {title}

      <div className="row g-3">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Where the directory is thin</h4>
              <p className="card-title-desc mb-3">
                {liveTotal} live {liveTotal === 1 ? "listing" : "listings"} across {rolled.length}{" "}
                categories, busiest first. A category with very few is a thin page &mdash; worth
                filling before it is promoted.
              </p>

              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col" className="text-end">
                        Live
                      </th>
                      <th scope="col" className="text-end">
                        All statuses
                      </th>
                      <th scope="col" className="text-end">
                        Subcategories
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolled.map((row) => (
                      <tr key={row.slug} className={row.activeCount === 0 ? "table-warning" : undefined}>
                        <td className="py-3">
                          <Link
                            href={`/super-admin/listings/by-category/${row.slug}`}
                            className="fw-semibold text-body"
                          >
                            {row.name}
                          </Link>
                          {!row.isActive ? (
                            <span className="badge bg-warning-subtle text-warning ms-2">Retired</span>
                          ) : null}
                        </td>
                        <td className="py-3 text-end">{row.activeCount}</td>
                        {/* The gap between the two columns is the useful part: a category with 40
                            filed and 3 live has 37 sitting in review or suspended. */}
                        <td className="py-3 text-end text-muted">{row.totalCount}</td>
                        <td className="py-3 text-end text-muted">{row.subcategories}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
