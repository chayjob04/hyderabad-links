import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { EmptyState, FilterTabs } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_REPORTS,
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  formatWhen,
  getAdminProfile,
  getReportQueue,
} from "@/lib/admin-api";
import { ReportDecision } from "./ReportDecision";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ status?: string; page?: string; decided?: string }> };

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  actioned: "Dealt with",
  dismissed: "Dismissed",
};

/**
 * The report queue, on the original's Minia layout.
 *
 * Like the review queue, each entry carries prose — the reporter's own words, and often the review
 * being complained about — so it stays a block rather than a table row. The quote keeps its left
 * rule, as a `blockquote` with the theme's border utilities.
 */
export default async function ReportsPage({ searchParams }: Props) {
  const { status: rawStatus, page: rawPage, decided } = await searchParams;

  const status = REPORT_STATUSES.includes(rawStatus as (typeof REPORT_STATUSES)[number]) ? rawStatus! : "open";
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [result, me] = await Promise.all([getReportQueue(status, page), getAdminProfile()]);
  const mayHandle = me.ok && me.data.permissions.includes(PERMISSION_REPORTS);

  return (
    <>
      <PageTitle title="Reports" breadcrumb={[{ label: "Listings" }, { label: STATUS_LABEL[status] ?? "Reports" }]} />

      <div className="row mb-3">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-1">Reported listings and reviews</h4>
              <p className="card-title-desc mb-3">
                Anyone can report a listing or a published review, with or without an account.
                Closing a report does not change the listing: suspend it or reject the review
                separately.
              </p>

              <FilterTabs
                tabs={REPORT_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] ?? value }))}
                current={status}
                hrefFor={(value) => `/admin/reports?status=${value}`}
              />

              {decided ? (
                <div role="status" className="alert alert-success">
                  Report closed.
                </div>
              ) : null}

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.status === 403
                    ? "Your account does not have permission to handle reports."
                    : result.message}
                </div>
              ) : result.data.items.length === 0 ? (
                <EmptyState
                  icon="bx bx-flag"
                  title={
                    status === "open"
                      ? "Nothing has been reported"
                      : `No ${STATUS_LABEL[status]!.toLowerCase()} reports`
                  }
                >
                  {result.data.total > 0
                    ? "That page is past the end of the list."
                    : "Reports appear here as they come in."}
                </EmptyState>
              ) : (
                <>
                  <p className="text-muted font-size-13">
                    {result.data.total} {result.data.total === 1 ? "report" : "reports"}
                  </p>

                  {result.data.items.map((report) => (
                    <div key={report.id} className="border rounded p-4 mb-3">
                      <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
                        <div className="min-w-0">
                          <h5 className="font-size-16 mb-1">{report.subjectName}</h5>
                          <p className="text-muted font-size-13 mb-0">
                            {report.subjectType === "listing" ? "A listing" : "A review"} &middot;{" "}
                            {formatWhen(report.createdAt)}
                          </p>
                        </div>
                        <span className="badge bg-warning-subtle text-warning font-size-13">
                          {REPORT_REASON_LABELS[report.reason] ?? report.reason}
                        </span>
                      </div>

                      {report.details ? (
                        <p className="mt-3 mb-0" style={{ whiteSpace: "pre-line" }}>
                          {report.details}
                        </p>
                      ) : null}

                      {report.reviewBody ? (
                        <blockquote
                          className="border-start border-3 ps-3 mt-3 mb-0 text-muted"
                          style={{ whiteSpace: "pre-line" }}
                        >
                          {report.reviewBody}
                        </blockquote>
                      ) : null}

                      <p className="mt-3 mb-0">
                        {report.subjectType === "listing" ? (
                          <Link href={`/admin/listings/${report.subjectId}`} className="font-size-13">
                            Open the listing &rarr;
                          </Link>
                        ) : (
                          <Link href="/admin/reviews?status=approved" className="font-size-13">
                            Open the published reviews &rarr;
                          </Link>
                        )}
                      </p>

                      {report.resolutionNote ? (
                        <div className="alert alert-light border mt-3 mb-0 py-2 px-3 font-size-13">
                          <span className="fw-semibold">Outcome:</span> {report.resolutionNote}
                        </div>
                      ) : null}

                      {status === "open" && mayHandle ? <ReportDecision reportId={report.id} /> : null}
                    </div>
                  ))}

                  <Pagination
                    page={result.data.page}
                    totalPages={result.data.totalPages}
                    params={{ status }}
                    basePath="/admin/reports"
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
