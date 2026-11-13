import type { Metadata } from "next";
import Link from "next/link";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import { PageTitle } from "@/components/minia/PageTitle";
import { StatCard } from "@/components/minia/StatCard";
import {
  formatWhen,
  getAdminSummary,
  listAdminPage,
  listRoles,
  getProfile,
  type AdminRow,
} from "@/lib/super-admin-api";
import { ResetMfaForm, RolesForm, StatusForm } from "./AccountControls";
import { CreateAdminButton } from "./AdminControls";

export const metadata: Metadata = { title: "Admin accounts" };
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ search?: string; role?: string; status?: string; sort?: string; page?: string }>;
};

/**
 * Admin Accounts: who can sign in to the staff side, what they may do, and the state of their
 * security.
 *
 * Presented in the original application's Minia theme — `.page-title-box`, `.card`, `.table`,
 * `.badge`, `.pagination` are all the theme's own classes, so this page is styled by the same
 * stylesheet the original was. Nothing about the data changed with it: the same four API calls,
 * the same filters, the same controls. Only the markup around them is new.
 *
 * Every figure comes from the database. Nothing on this page is computed in the browser.
 */
export default async function AdminAccountsPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = {
    search: params.search ?? "",
    role: params.role ?? "all",
    status: params.status ?? "all",
    sort: params.sort ?? "newest",
    page: Number(params.page ?? "1") || 1,
  };

  const [summary, page, roles, me] = await Promise.all([
    getAdminSummary(),
    listAdminPage(filters),
    listRoles(),
    getProfile(),
  ]);

  const failure = !page.ok ? page : !roles.ok ? roles : null;
  const filtered = filters.search !== "" || filters.role !== "all" || filters.status !== "all";

  return (
    <SuperAdminChrome>
      <PageTitle
        title="Admin Accounts"
        breadcrumb={[{ label: "Configurations" }, { label: "Admins" }]}
        action={roles.ok ? <CreateAdminButton roleSlugs={roles.data.map((role) => role.slug)} /> : null}
      />

      {failure ? (
        <div className="alert alert-danger" role="alert">
          {failure.status === 403 ? "Your account cannot manage administrators." : failure.message}
        </div>
      ) : null}

      {/* Summary cards. Counted across every account, never across the filtered page: a card that
          changed when you typed in the search box would be answering a different question. */}
      {summary.ok ? (
        <div className="row g-3 mb-4">
          <StatCard label="Total Admins" value={summary.data.total} />
          <StatCard label="Active" value={summary.data.active} />
          <StatCard label="Super Admins" value={summary.data.superAdmins} />
          <StatCard label="Disabled" value={summary.data.disabled} />
        </div>
      ) : null}

      {/* Filters. A plain GET form, so the URL is the state: a filtered view can be linked, and
          the back button does what it should. */}
      <div className="card mb-3">
        <div className="card-body">
          <form method="GET" className="row g-3 align-items-end">
            <div className="col-md-6 col-lg-4">
              <label htmlFor="search" className="form-label">
                Search
              </label>
              <input
                id="search"
                name="search"
                defaultValue={filters.search}
                placeholder="Name or email"
                className="form-control"
              />
            </div>
            <Select name="role" label="Role" value={filters.role} options={[["all", "All roles"], ["admin", "Admin"], ["super_admin", "Super Admin"]]} />
            <Select name="status" label="Status" value={filters.status} options={[["all", "All"], ["active", "Active"], ["disabled", "Disabled"], ["invited", "Invited"]]} />
            <Select
              name="sort"
              label="Sort"
              value={filters.sort}
              options={[["newest", "Newest first"], ["oldest", "Oldest first"], ["name", "Name"], ["email", "Email"], ["status", "Status"], ["last_login", "Last login"]]}
            />
            <div className="col-12">
              <button type="submit" className="btn btn-primary">
                <i className="bx bx-filter-alt align-middle me-1" /> Apply
              </button>
              {filtered ? (
                <Link href="/super-admin/admins" className="btn btn-light ms-2">
                  Clear
                </Link>
              ) : null}
            </div>
          </form>
        </div>
      </div>

      {page.ok && page.data.items.length === 0 ? (
        <div className="card mb-3">
          <div className="card-body text-center py-5">
            <div className="avatar-md mx-auto mb-4">
              <span className="avatar-title bg-light text-secondary rounded-circle font-size-24">
                <i className="bx bx-user-x" />
              </span>
            </div>
            <h5>{filtered ? "No administrators match those filters" : "There are no administrator accounts"}</h5>
            <p className="text-muted mb-0">
              {filtered
                ? "Try a different search, or clear the filters."
                : "Create the first one with the button above. Nobody can sign in to the staff side until you do."}
            </p>
          </div>
        </div>
      ) : null}

      {page.ok && page.data.items.length > 0 ? (
        <div className="card mb-3">
          <div className="card-body">
            <h4 className="card-title mb-1">Administrators</h4>
            <p className="card-title-desc mb-3">
              {page.data.total} account{page.data.total === 1 ? "" : "s"}
              {filtered ? " matching these filters" : ""}.
            </p>

            <div className="table-responsive">
              <table className="table table-hover align-middle table-nowrap mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">MFA</th>
                    <th scope="col">Last Login</th>
                    <th scope="col">Created</th>
                    <th scope="col">Password Changed</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.items.map((account) => (
                    <tr key={account.id}>
                      <td className="text-muted">{account.id}</td>
                      <td>
                        <span className="fw-semibold">{account.displayName}</span>
                        {me.ok && me.data.id === account.id ? (
                          <span className="text-muted font-size-11 ms-1">(you)</span>
                        ) : null}
                      </td>
                      <td className="text-muted">{account.email}</td>
                      <td><Roles roles={account.roles} /></td>
                      <td><Status account={account} /></td>
                      <td><Mfa account={account} /></td>
                      <td className="text-muted">{formatWhen(account.lastLoginAt)}</td>
                      <td className="text-muted">{formatWhen(account.createdAt)}</td>
                      <td className="text-muted">{formatWhen(account.passwordChangedAt)}</td>
                      <td>
                        <Link href={`/super-admin/admins/${account.id}`} className="btn btn-sm btn-primary">
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {page.data.totalPages > 1 ? (
              <nav aria-label="Pages" className="d-flex align-items-center justify-content-between mt-3">
                <p className="text-muted mb-0 font-size-13">
                  Page {page.data.page} of {page.data.totalPages}
                </p>
                <ul className="pagination pagination-rounded mb-0">
                  <PageLink filters={filters} to={page.data.page - 1} disabled={page.data.page <= 1}>
                    <i className="mdi mdi-chevron-left" />
                  </PageLink>
                  <PageLink filters={filters} to={page.data.page + 1} disabled={page.data.page >= page.data.totalPages}>
                    <i className="mdi mdi-chevron-right" />
                  </PageLink>
                </ul>
              </nav>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The quick controls stay on this page for the row you are looking at: roles, status and
          clearing an authenticator are one click each, and sending somebody to a detail page to
          toggle a status would be worse. Everything heavier is behind Manage. */}
      {page.ok && roles.ok && page.data.items.length > 0 ? (
        <div className="card mb-3">
          <div className="card-body">
            <h4 className="card-title mb-1">Quick changes</h4>
            <p className="card-title-desc mb-3">
              Roles, access and authenticators for the accounts on this page.
            </p>
            {page.data.items.map((account, index) => (
              <div key={account.id} className={index === 0 ? "" : "border-top pt-3 mt-3"}>
                <p className="fw-semibold mb-3">
                  {account.displayName} <span className="text-muted fw-normal">&middot; {account.email}</span>
                </p>
                <div className="row g-3">
                  <div className="col-md-4">
                    <RolesForm adminId={account.id} roles={account.roles} allRoles={roles.data} />
                  </div>
                  <div className="col-md-4">
                    <StatusForm adminId={account.id} status={account.status} />
                  </div>
                  <div className="col-md-4">
                    <ResetMfaForm adminId={account.id} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </SuperAdminChrome>
  );
}


function Select({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <div className="col-md-6 col-lg-2">
      <label htmlFor={name} className="form-label">
        {label}
      </label>
      <select id={name} name={name} defaultValue={value} className="form-select">
        {options.map(([slug, text]) => (
          <option key={slug} value={slug}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

function Roles({ roles }: { roles: string[] }) {
  if (roles.length === 0) return <span className="text-muted font-size-12">No role</span>;
  return (
    <>
      {roles.map((role) => (
        <span
          key={role}
          className={`badge ${role === "super_admin" ? "bg-primary-subtle text-primary" : "bg-secondary-subtle text-secondary"} me-1`}
        >
          {role === "super_admin" ? "Super Admin" : "Admin"}
        </span>
      ))}
    </>
  );
}

function Status({ account }: { account: AdminRow }) {
  const tone =
    account.status === "active"
      ? "bg-success-subtle text-success"
      : account.status === "disabled"
        ? "bg-secondary-subtle text-secondary"
        : "bg-warning-subtle text-warning";
  return (
    <>
      <span className={`badge ${tone}`}>{account.status}</span>
      {account.locked ? <span className="badge bg-danger-subtle text-danger ms-1">locked</span> : null}
      {account.mustChangePassword ? (
        <span className="badge bg-warning-subtle text-warning ms-1">must change password</span>
      ) : null}
    </>
  );
}

function Mfa({ account }: { account: AdminRow }) {
  return account.mfaEnrolled ? (
    <>
      <span className="badge bg-success-subtle text-success">enrolled</span>
      <span className="d-block text-muted font-size-11 mt-1">{account.unusedRecoveryCodes} codes left</span>
    </>
  ) : (
    <span className="badge bg-warning-subtle text-warning">not set up</span>
  );
}

function PageLink({
  filters,
  to,
  disabled,
  children,
}: {
  filters: { search: string; role: string; status: string; sort: string };
  to: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <li className="page-item disabled">
        <span className="page-link">{children}</span>
      </li>
    );
  }
  const query = new URLSearchParams();
  if (filters.search) query.set("search", filters.search);
  if (filters.role !== "all") query.set("role", filters.role);
  if (filters.status !== "all") query.set("status", filters.status);
  if (filters.sort !== "newest") query.set("sort", filters.sort);
  if (to > 1) query.set("page", String(to));
  const suffix = query.toString();
  return (
    <li className="page-item">
      <Link href={`/super-admin/admins${suffix ? `?${suffix}` : ""}`} className="page-link">
        {children}
      </Link>
    </li>
  );
}
