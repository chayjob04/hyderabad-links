import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/AccessDenied";
import { FilterTabs } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import { PERMISSION_LISTINGS_EDIT, getCategoryCounts, getProfile } from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Listings by subcategory" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ empty?: string }> };

/**
 * Every subcategory with its listing count — the original's
 * `Super/ListingsByCategory/BySubCategory`.
 *
 * This is the level listings are actually filed at, so it is the level where "thin" matters: a
 * subcategory with nothing on it is a page in the navigation that leads to an empty result, and
 * there are usually more of those than anyone expects. The `?empty=1` filter exists to make that
 * list short enough to act on in one sitting.
 *
 * Same rows as the by-category screen, read one level down, so the two cannot disagree about a
 * number.
 */
export default async function ListingsBySubcategoryPage({ searchParams }: Props) {
  const { empty } = await searchParams;
  const onlyEmpty = empty === "1";

  const [result, me] = await Promise.all([getCategoryCounts(), getProfile()]);
  const mayView = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);

  if (me.ok && !mayView) {
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="listings by subcategory" />;
  }

  const title = (
    <PageTitle
      title="By subcategory"
      breadcrumb={[{ label: "Listings" }, { label: "By subcategory" }]}
      action={
        <Link href="/super-admin/listings/by-category" className="btn btn-outline-secondary">
          By category <i className="mdi mdi-arrow-right ms-1" />
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

  const all = result.data
    .filter((row) => row.level === 2)
    .sort((a, b) => b.activeCount - a.activeCount || a.name.localeCompare(b.name));

  const emptyCount = all.filter((row) => row.activeCount === 0).length;
  const rows = onlyEmpty ? all.filter((row) => row.activeCount === 0) : all;

  return (
    <>
      {title}

      <div className="row g-3">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Where listings are actually filed</h4>
              <p className="card-title-desc mb-3">
                {all.length} subcategories, busiest first. {emptyCount} have nothing live on them.
              </p>

              <FilterTabs
                label="Filter subcategories"
                tabs={[
                  { value: "all", label: "All" },
                  { value: "empty", label: `Empty only (${emptyCount})` },
                ]}
                current={onlyEmpty ? "empty" : "all"}
                hrefFor={(value) =>
                  value === "empty"
                    ? "/super-admin/listings/by-subcategory?empty=1"
                    : "/super-admin/listings/by-subcategory"
                }
              />

              {rows.length === 0 ? (
                <div className="alert alert-success mb-0">
                  Every subcategory has at least one live listing.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col">Subcategory</th>
                        <th scope="col">In</th>
                        <th scope="col" className="text-end">
                          Live
                        </th>
                        <th scope="col" className="text-end">
                          All statuses
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.slug} className={row.activeCount === 0 ? "table-warning" : undefined}>
                          <td className="py-3">
                            <Link
                              href={`/super-admin/listings/by-subcategory/${row.slug}`}
                              className="fw-semibold text-body"
                            >
                              {row.name}
                            </Link>
                            {!row.isActive ? (
                              <span className="badge bg-warning-subtle text-warning ms-2">Retired</span>
                            ) : null}
                          </td>
                          <td className="py-3 text-muted">{row.parentName ?? "—"}</td>
                          <td className="py-3 text-end">{row.activeCount}</td>
                          <td className="py-3 text-end text-muted">{row.totalCount}</td>
                        </tr>
                      ))}
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
