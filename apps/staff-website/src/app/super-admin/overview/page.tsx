import type { Metadata } from "next";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import { PageTitle } from "@/components/minia/PageTitle";
import { StatCard } from "@/components/minia/StatCard";
import { getOverview } from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Drafts",
  pending_review: "Waiting for review",
  active: "Live",
  rejected: "Needs changes",
  suspended: "Suspended",
  archived: "Archived",
};

/**
 * Platform figures, on the original's dashboard layout.
 *
 * Every number is a count of rows that exist. There is deliberately no "visits", "page views" or
 * "revenue" here: nothing in the database records any of them, and a tile that always reads zero
 * would be worse than no tile.
 *
 * The figures used to sit in oversized bordered boxes inside a `max-w-5xl` column, which left the
 * page both too tall and too narrow against a 250px sidebar. They are `card-h-100` now, four to a
 * row in `container-fluid`, which is the shape and the width the original uses.
 */
export default async function OverviewPage() {
  const result = await getOverview();

  return (
    <SuperAdminChrome>
      <PageTitle title="Dashboard" breadcrumb={[{ label: "Super Admin" }, { label: "Dashboard" }]} />

      {!result.ok ? (
        <div className="alert alert-danger" role="alert">
          {result.status === 403 ? "Your account cannot see platform analytics." : result.message}
        </div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Businesses" value={result.data.businesses} />
            <StatCard label="Owner accounts" value={result.data.owners} />
            <StatCard label="Admin accounts" value={result.data.adminAccounts} href="/super-admin/admins" />
            <StatCard label="New enquiries" value={result.data.newEnquiries} />
          </div>

          <div className="row g-3 mb-4">
            <StatCard label="Reviews waiting" value={result.data.pendingReviews} href="/admin/reviews" />
            <StatCard label="Reports open" value={result.data.openReports} href="/admin/reports" />
          </div>

          <div className="row g-3 mb-4">
            <div className="col-12">
              <div className="card">
                <div className="card-body">
                  <h4 className="card-title mb-1">Listings by status</h4>
                  <p className="card-title-desc mb-3">
                    Every figure here is counted from the database as it is now.
                  </p>
                  <div className="row g-3">
                    {result.data.listingsByStatus.map((row) => (
                      <StatCard
                        key={row.key}
                        label={STATUS_LABEL[row.key] ?? row.key}
                        value={row.count}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-4">
            <div className="col-12">
              <div className="card">
                <div className="card-body">
                  <h4 className="card-title mb-1">Listings by plan</h4>
                  <p className="card-title-desc mb-3">
                    Free and Verified (&#8377;399 a year) are the only plans. A listing counts as
                    Verified for exactly as long as its paid period runs, so these figures follow
                    renewals and expiries on their own.
                  </p>
                  <div className="row g-3">
                    {result.data.listingsByPlan.map((row) => (
                      <StatCard key={row.key} label={row.key} value={row.count} width="col-xl-3 col-md-6" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </SuperAdminChrome>
  );
}
