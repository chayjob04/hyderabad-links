import type { Metadata } from "next";
import Link from "next/link";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
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

function Tile({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <dt className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{label}</dt>
      <dd className="mt-1 text-3xl font-bold text-neutral-900">{value}</dd>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm hover:border-neutral-400">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">{body}</div>
  );
}

/**
 * Platform figures.
 *
 * Every number is a count of rows that exist. There is deliberately no "visits", "page views" or
 * "revenue" here: nothing in the database records any of them, and a tile that always reads zero
 * would be worse than no tile.
 */
export default async function OverviewPage() {
  const result = await getOverview();

  return (
    <SuperAdminChrome>
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
        <h1 className="text-2xl font-bold">Platform overview</h1>
        <p className="mt-1 text-neutral-600">Every figure here is counted from the database as it is now.</p>

        {!result.ok ? (
          <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
            {result.status === 403 ? "Your account cannot see platform analytics." : result.message}
          </p>
        ) : (
          <>
            <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Tile label="Businesses" value={result.data.businesses} />
              <Tile label="Owner accounts" value={result.data.owners} />
              <Tile label="Admin accounts" value={result.data.adminAccounts} href="/admins" />
              <Tile label="New enquiries" value={result.data.newEnquiries} />
            </dl>

            <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Tile label="Reviews waiting" value={result.data.pendingReviews} />
              <Tile label="Reports open" value={result.data.openReports} />
            </dl>

            <section className="mt-10">
              <h2 className="text-lg font-semibold">Listings by status</h2>
              <dl className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
                {result.data.listingsByStatus.map((row) => (
                  <Tile key={row.key} label={STATUS_LABEL[row.key] ?? row.key} value={row.count} />
                ))}
              </dl>
            </section>

            <section className="mt-10">
              <h2 className="text-lg font-semibold">Listings by plan</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Free and Verified (&#8377;399 a year) are the only plans. A listing counts as
                Verified for exactly as long as its paid period runs, so these figures follow
                renewals and expiries on their own.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-4">
                {result.data.listingsByPlan.map((row) => (
                  <Tile key={row.key} label={row.key} value={row.count} />
                ))}
              </dl>
            </section>
          </>
        )}
      </main>
    </SuperAdminChrome>
  );
}
