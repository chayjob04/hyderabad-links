import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/AccessDenied";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import { PERMISSION_USERS_VIEW, formatWhen, getProfile, listAccounts } from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Business accounts" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };

/**
 * The people who own listings — the original's `Super/RegisterData`.
 *
 * Only accounts that hold at least one listing. A phone number that asked for a login code once and
 * never finished has a `users` row too, and listing those would turn this into a log of abandoned
 * sign-ins rather than a list of the businesses on the platform.
 *
 * What is not here, deliberately: no way to sign in as somebody. Staff can see who an account is
 * and suspend it. Acting as a person is not an administrative convenience, and it is not built.
 */
export default async function AccountsPage({ searchParams }: Props) {
  const { q, status, page: rawPage } = await searchParams;
  const page = Number.parseInt(rawPage ?? "1", 10);
  const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1;

  const [result, me] = await Promise.all([
    listAccounts({ q, status, page: currentPage }),
    getProfile(),
  ]);
  const mayView = me.ok && me.data.permissions.includes(PERMISSION_USERS_VIEW);

  if (me.ok && !mayView) {
    return <AccessDenied surface="super" permission={PERMISSION_USERS_VIEW} what="business accounts" />;
  }

  return (
    <>
      <PageTitle
        title="Business accounts"
        breadcrumb={[{ label: "Business accounts" }, { label: "Accounts" }]}
      />

      <div className="row g-3">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Owners</h4>
              <p className="card-title-desc mb-3">
                Everyone who owns at least one listing. Accounts that never finished signing in are
                not listed.
              </p>

              <form className="row g-2 align-items-end mb-3">
                <div className="col-md-5">
                  <label htmlFor="q" className="form-label">
                    Search
                  </label>
                  <input
                    id="q"
                    name="q"
                    defaultValue={q ?? ""}
                    placeholder="Name, email or phone"
                    className="form-control"
                  />
                </div>
                <div className="col-md-3">
                  <label htmlFor="status" className="form-label">
                    Status
                  </label>
                  <select id="status" name="status" defaultValue={status ?? ""} className="form-select">
                    <option value="">Any status</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <button type="submit" className="btn btn-primary w-100">
                    Search
                  </button>
                </div>
              </form>

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.message}
                </div>
              ) : result.data.items.length === 0 ? (
                <EmptyState icon="bx bx-user-x" title="No accounts match that">
                  Try a different name, number or status.
                </EmptyState>
              ) : (
                <>
                  <p className="text-muted font-size-13">
                    {result.data.total} {result.data.total === 1 ? "account" : "accounts"}
                  </p>

                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Account</th>
                          <th scope="col">Phone</th>
                          <th scope="col" className="text-end">
                            Listings
                          </th>
                          <th scope="col">Joined</th>
                          <th scope="col" className="text-center" style={{ width: "8rem" }}>
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.items.map((account) => (
                          <tr key={account.id}>
                            <td className="py-3">
                              <Link
                                href={`/super-admin/accounts/${account.id}`}
                                className="fw-semibold text-body"
                              >
                                {/* An account can legitimately have no name: sign-in is by phone,
                                    and the name is asked for later. The phone is the identity, so
                                    it stands in. */}
                                {account.name?.trim() || account.phoneE164}
                              </Link>
                              {account.email ? (
                                <span className="d-block text-muted font-size-12">{account.email}</span>
                              ) : null}
                            </td>
                            <td className="py-3 text-muted text-nowrap">
                              {account.phoneE164}
                              {!account.phoneVerified ? (
                                <span className="badge bg-warning-subtle text-warning ms-2">
                                  Unverified
                                </span>
                              ) : null}
                            </td>
                            <td className="py-3 text-end">{account.listingCount}</td>
                            <td className="py-3 text-muted font-size-13 text-nowrap">
                              {formatWhen(account.createdAt)}
                            </td>
                            <td className="py-3 text-center">
                              <span
                                className={`badge ${
                                  account.status === "active"
                                    ? "bg-success-subtle text-success"
                                    : "bg-danger-subtle text-danger"
                                }`}
                              >
                                {account.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    page={result.data.page}
                    totalPages={result.data.totalPages}
                    params={{ q, status }}
                    basePath="/super-admin/accounts"
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
