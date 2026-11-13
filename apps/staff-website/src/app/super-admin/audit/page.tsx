import type { Metadata } from "next";
import Link from "next/link";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import { PageTitle } from "@/components/minia/PageTitle";
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
 *
 * Presented on the original theme's classes. The filters are still links that set the query string,
 * so a filtered view can be shared and the back button works; only their appearance changed.
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
    return "/super-admin/audit" + (suffix ? "?" + suffix : "");
  };

  return (
    <SuperAdminChrome>
      <PageTitle title="Audit log" breadcrumb={[{ label: "Mixed" }, { label: "Audit Dashboard" }]} />

      <div className="card mb-3">
        <div className="card-body">
          <h4 className="card-title mb-1">Every decision staff have taken</h4>
          <p className="card-title-desc mb-3">
            Newest first. Nothing here can be changed or removed.
          </p>

          {/* Filter by what was changed. Buttons rather than tabs, as the original's filter row. */}
          <nav aria-label="Filter by what was changed" className="d-flex flex-wrap gap-2 mb-3">
            <Link
              href={hrefFor({ entityType: undefined, page: undefined })}
              aria-current={entityType ? undefined : "page"}
              className={`btn btn-sm ${entityType ? "btn-outline-secondary" : "btn-primary"}`}
            >
              Everything
            </Link>
            {ENTITY_TYPES.map((value) => (
              <Link
                key={value}
                href={hrefFor({ entityType: value, page: undefined })}
                aria-current={entityType === value ? "page" : undefined}
                className={`btn btn-sm ${entityType === value ? "btn-primary" : "btn-outline-secondary"}`}
              >
                {value.replace("_", " ")}
              </Link>
            ))}
          </nav>

          {action ? (
            <div className="alert alert-info py-2 px-3 font-size-13 d-flex align-items-center justify-content-between">
              <span>
                Filtered to <code className="text-body">{action}</code>
              </span>
              <Link href={hrefFor({ action: undefined, page: undefined })} className="btn btn-sm btn-light">
                Clear
              </Link>
            </div>
          ) : null}

          {!result.ok ? (
            <div role="alert" className="alert alert-danger mb-0">
              {result.status === 403 ? "Your account cannot read the audit log." : result.message}
            </div>
          ) : result.data.items.length === 0 ? (
            <div className="text-center py-5">
              <div className="avatar-md mx-auto mb-4">
                <span className="avatar-title bg-light text-secondary rounded-circle font-size-24">
                  <i className="bx bx-search-alt" />
                </span>
              </div>
              <h5>Nothing to show</h5>
              <p className="text-muted mb-0">
                {result.data.total > 0
                  ? "That page is past the end of the log."
                  : "No entries match these filters."}
              </p>
            </div>
          ) : (
            <>
              <p className="text-muted font-size-13">{result.data.total} entries</p>

              <div className="table-responsive">
                <table className="table table-hover align-middle table-nowrap mb-0">
                  <thead className="table-light">
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Who</th>
                      <th scope="col">What</th>
                      <th scope="col">On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.items.map((entry) => (
                      <tr key={entry.id}>
                        <td className="text-muted">{formatWhen(entry.occurredAt)}</td>
                        <td>{entry.actorName ?? <span className="text-muted">{entry.actorType}</span>}</td>
                        <td>
                          <Link
                            href={hrefFor({ action: entry.action, page: undefined })}
                            className="text-body"
                          >
                            <code className="text-reset">{entry.action}</code>
                          </Link>
                        </td>
                        <td className="text-muted">
                          {entry.entityType ? `${entry.entityType} ${entry.entityId ?? ""}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.data.totalPages > 1 ? (
                <nav
                  aria-label="Pagination"
                  className="d-flex align-items-center justify-content-between mt-3"
                >
                  <p className="text-muted mb-0 font-size-13" aria-live="polite">
                    Page {result.data.page} of {result.data.totalPages}
                  </p>
                  <ul className="pagination pagination-rounded mb-0">
                    <li className={`page-item${result.data.page > 1 ? "" : " disabled"}`}>
                      {result.data.page > 1 ? (
                        <Link href={hrefFor({ page: String(result.data.page - 1) })} rel="prev" className="page-link">
                          <i className="mdi mdi-chevron-left" />
                        </Link>
                      ) : (
                        <span className="page-link">
                          <i className="mdi mdi-chevron-left" />
                        </span>
                      )}
                    </li>
                    <li className={`page-item${result.data.page < result.data.totalPages ? "" : " disabled"}`}>
                      {result.data.page < result.data.totalPages ? (
                        <Link href={hrefFor({ page: String(result.data.page + 1) })} rel="next" className="page-link">
                          <i className="mdi mdi-chevron-right" />
                        </Link>
                      ) : (
                        <span className="page-link">
                          <i className="mdi mdi-chevron-right" />
                        </span>
                      )}
                    </li>
                  </ul>
                </nav>
              ) : null}
            </>
          )}
        </div>
      </div>
    </SuperAdminChrome>
  );
}
