import type { Metadata } from "next";
import Link from "next/link";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import { formatWhen, getAudit } from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ action?: string; entityType?: string; page?: string }> };

/** The entity kinds the log actually carries, offered as filters rather than a free-text box. */
const ENTITY_TYPES = ["listing", "review", "report", "admin_user"];

/**
 * The append-only audit log.
 *
 * Read-only on purpose: nothing here can be edited or deleted from the application, which is what
 * makes it worth reading. An entry whose admin account has since been removed shows no name, because
 * the entry outlives the account.
 */
export default async function AuditPage({ searchParams }: Props) {
  const { action, entityType, page: rawPage } = await searchParams;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const result = await getAudit({ action, entityType, page });

  const hrefFor = (changes: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { action, entityType, ...changes };
    for (const [key, value] of Object.entries(merged)) {
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    return "/audit" + (suffix ? "?" + suffix : "");
  };

  return (
    <SuperAdminChrome>
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="mt-1 text-neutral-600">
          Every decision staff have taken, newest first. Nothing here can be changed or removed.
        </p>

        <nav aria-label="Filter by what was changed" className="mt-5 flex flex-wrap gap-2">
          <Link
            href={hrefFor({ entityType: undefined, page: undefined })}
            aria-current={entityType ? undefined : "page"}
            className={
              entityType
                ? "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                : "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
            }
          >
            Everything
          </Link>
          {ENTITY_TYPES.map((value) => (
            <Link
              key={value}
              href={hrefFor({ entityType: value, page: undefined })}
              aria-current={entityType === value ? "page" : undefined}
              className={
                entityType === value
                  ? "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              }
            >
              {value.replace("_", " ")}
            </Link>
          ))}
        </nav>

        {action ? (
          <p className="mt-4 text-sm text-neutral-700">
            Filtered to <span className="font-mono">{action}</span>{" "}
            <Link href={hrefFor({ action: undefined, page: undefined })} className="font-medium text-neutral-900 underline">
              clear
            </Link>
          </p>
        ) : null}

        {!result.ok ? (
          <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
            {result.status === 403 ? "Your account cannot read the audit log." : result.message}
          </p>
        ) : result.data.items.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
            <h2 className="text-lg font-semibold">Nothing to show</h2>
            <p className="mt-1 text-neutral-600">
              {result.data.total > 0 ? "That page is past the end of the log." : "No entries match these filters."}
            </p>
          </div>
        ) : (
          <>
            <p className="mt-5 text-sm text-neutral-600">{result.data.total} entries</p>

            <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-semibold">When</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Who</th>
                    <th scope="col" className="px-4 py-2 font-semibold">What</th>
                    <th scope="col" className="px-4 py-2 font-semibold">On</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map((entry) => (
                    <tr key={entry.id} className="border-b border-neutral-100 last:border-b-0">
                      <td className="px-4 py-2 whitespace-nowrap text-neutral-700">{formatWhen(entry.occurredAt)}</td>
                      <td className="px-4 py-2">
                        {entry.actorName ?? <span className="text-neutral-500">{entry.actorType}</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Link href={hrefFor({ action: entry.action, page: undefined })} className="font-mono text-neutral-900 underline-offset-2 hover:underline">
                          {entry.action}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-neutral-700">
                        {entry.entityType ? `${entry.entityType} ${entry.entityId ?? ""}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.data.totalPages > 1 ? (
              <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-3">
                {result.data.page > 1 ? (
                  <Link href={hrefFor({ page: String(result.data.page - 1) })} rel="prev" className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
                    Previous
                  </Link>
                ) : (
                  <span className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-400">Previous</span>
                )}
                <p className="text-sm text-neutral-600" aria-live="polite">
                  Page {result.data.page} of {result.data.totalPages}
                </p>
                {result.data.page < result.data.totalPages ? (
                  <Link href={hrefFor({ page: String(result.data.page + 1) })} rel="next" className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
                    Next
                  </Link>
                ) : (
                  <span className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-400">Next</span>
                )}
              </nav>
            ) : null}
          </>
        )}
      </main>
    </SuperAdminChrome>
  );
}
