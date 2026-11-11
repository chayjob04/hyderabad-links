import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
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

export default async function ReportsPage({ searchParams }: Props) {
  const { status: rawStatus, page: rawPage, decided } = await searchParams;

  const status = REPORT_STATUSES.includes(rawStatus as (typeof REPORT_STATUSES)[number]) ? rawStatus! : "open";
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [result, me] = await Promise.all([getReportQueue(status, page), getAdminProfile()]);
  const mayHandle = me.ok && me.data.permissions.includes(PERMISSION_REPORTS);

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="mt-1 text-neutral-600">
        Anyone can report a listing or a published review, with or without an account. Closing a
        report does not change the listing: suspend it or reject the review separately.
      </p>

      <nav aria-label="Filter by status" className="mt-5 flex flex-wrap gap-2">
        {REPORT_STATUSES.map((value) => {
          const selected = value === status;
          return (
            <Link
              key={value}
              href={`/admin/reports?status=${value}`}
              aria-current={selected ? "page" : undefined}
              className={
                selected
                  ? "rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              }
            >
              {STATUS_LABEL[value]}
            </Link>
          );
        })}
      </nav>

      {decided ? (
        <p role="status" className="mt-5 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
          Report closed.
        </p>
      ) : null}

      {!result.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.status === 403 ? "Your account does not have permission to handle reports." : result.message}
        </p>
      ) : result.data.items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold">
            {status === "open" ? "Nothing has been reported" : `No ${STATUS_LABEL[status]!.toLowerCase()} reports`}
          </h2>
          <p className="mt-1 text-neutral-600">
            {result.data.total > 0 ? "That page is past the end of the list." : "Reports appear here as they come in."}
          </p>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-neutral-600">
            {result.data.total} {result.data.total === 1 ? "report" : "reports"}
          </p>

          <ul className="mt-3 space-y-4">
            {result.data.items.map((report) => (
              <li key={report.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{report.subjectName}</h2>
                    <p className="mt-0.5 text-sm text-neutral-600">
                      {report.subjectType === "listing" ? "A listing" : "A review"} &middot;{" "}
                      {formatWhen(report.createdAt)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-900">
                    {REPORT_REASON_LABELS[report.reason] ?? report.reason}
                  </span>
                </div>

                {report.details ? (
                  <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line text-neutral-800">
                    {report.details}
                  </p>
                ) : null}

                {report.reviewBody ? (
                  <blockquote className="mt-3 border-l-4 border-neutral-200 pl-3 text-[15px] leading-relaxed whitespace-pre-line text-neutral-700">
                    {report.reviewBody}
                  </blockquote>
                ) : null}

                {report.subjectType === "listing" ? (
                  <p className="mt-3">
                    <Link
                      href={`/admin/listings/${report.subjectId}`}
                      className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
                    >
                      Open the listing &rarr;
                    </Link>
                  </p>
                ) : (
                  <p className="mt-3">
                    <Link
                      href="/admin/reviews?status=approved"
                      className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
                    >
                      Open the published reviews &rarr;
                    </Link>
                  </p>
                )}

                {report.resolutionNote ? (
                  <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                    <span className="font-semibold">Outcome:</span> {report.resolutionNote}
                  </p>
                ) : null}

                {status === "open" && mayHandle ? <ReportDecision reportId={report.id} /> : null}
              </li>
            ))}
          </ul>

          <Pagination
            page={result.data.page}
            totalPages={result.data.totalPages}
            params={{ status }}
            basePath="/admin/reports"
          />
        </>
      )}
    </main>
  );
}
