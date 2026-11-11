import type { Metadata } from "next";
import Link from "next/link";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
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
 * Creating an account is here now (S0028). It used to say the command line was the only way,
 * because a new account needs its password delivered to its owner and no email provider is
 * configured — that is still true, so the password is set by the super admin, shown once, and must
 * be changed at first sign-in. No email is sent and none is needed.
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
      <main className="mx-auto max-w-7xl px-4 pt-8 pb-12">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Admin Accounts</h1>
            <p className="mt-1 text-neutral-600">
              Manage administrator accounts, roles and security.
            </p>
          </div>
          {roles.ok ? <CreateAdminButton roleSlugs={roles.data.map((role) => role.slug)} /> : null}
        </header>

        {failure ? (
          <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
            {failure.status === 403 ? "Your account cannot manage administrators." : failure.message}
          </p>
        ) : null}

        {/* Summary cards. Counted across every account, never across the filtered page: a card that
            changed when you typed in the search box would be answering a different question. */}
        {summary.ok ? (
          <section aria-label="Summary" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Total admins" value={summary.data.total} />
            <SummaryCard label="Active" value={summary.data.active} tone="good" />
            <SummaryCard label="Super admins" value={summary.data.superAdmins} tone="accent" />
            <SummaryCard label="Disabled" value={summary.data.disabled} tone="muted" />
          </section>
        ) : null}

        {/* Filters. A plain GET form, so the URL is the state: a filtered view can be linked, and
            the back button does what it should. */}
        <form method="GET" className="mt-6 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          <label className="lg:col-span-2">
            <span className="block text-xs font-semibold tracking-wide text-neutral-600 uppercase">Search</span>
            <input
              name="search"
              defaultValue={filters.search}
              placeholder="Name or email"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <Select name="role" label="Role" value={filters.role} options={[["all", "All roles"], ["admin", "Admin"], ["super_admin", "Super Admin"]]} />
          <Select name="status" label="Status" value={filters.status} options={[["all", "All"], ["active", "Active"], ["disabled", "Disabled"], ["invited", "Invited"]]} />
          <Select
            name="sort"
            label="Sort"
            value={filters.sort}
            options={[["newest", "Newest first"], ["oldest", "Oldest first"], ["name", "Name"], ["email", "Email"], ["status", "Status"], ["last_login", "Last login"]]}
          />
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
            <button type="submit" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
              Apply
            </button>
            {filtered ? (
              <Link href="/super-admin/admins" className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        {page.ok && page.data.items.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
            <p className="text-lg font-semibold text-neutral-900">
              {filtered ? "No administrators match those filters" : "There are no administrator accounts"}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-neutral-600">
              {filtered
                ? "Try a different search, or clear the filters."
                : "Create the first one with the button above. Nobody can sign in to the staff side until you do."}
            </p>
          </div>
        ) : null}

        {page.ok && page.data.items.length > 0 ? (
          <>
            {/* The table on a wide screen. Below `lg` the same rows render as cards, because ten
                columns on a phone is a horizontal scrollbar nobody uses. */}
            <div className="mt-6 hidden overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs tracking-wide text-neutral-600 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">ID</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Email</th>
                    <th className="px-4 py-3 font-semibold">Role</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">MFA</th>
                    <th className="px-4 py-3 font-semibold">Last login</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold">Password changed</th>
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {page.data.items.map((account) => (
                    <tr key={account.id} className="align-top hover:bg-neutral-50">
                      <td className="px-4 py-3 font-mono text-xs text-neutral-500">{account.id}</td>
                      <td className="px-4 py-3 font-semibold text-neutral-900">
                        {account.displayName}
                        {me.ok && me.data.id === account.id ? (
                          <span className="ml-2 text-xs font-medium text-neutral-500">(you)</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 break-all text-neutral-700">{account.email}</td>
                      <td className="px-4 py-3"><Roles roles={account.roles} /></td>
                      <td className="px-4 py-3"><Status account={account} /></td>
                      <td className="px-4 py-3"><Mfa account={account} /></td>
                      <td className="px-4 py-3 text-neutral-600">{formatWhen(account.lastLoginAt)}</td>
                      <td className="px-4 py-3 text-neutral-600">{formatWhen(account.createdAt)}</td>
                      <td className="px-4 py-3 text-neutral-600">{formatWhen(account.passwordChangedAt)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/super-admin/admins/${account.id}`} className="font-semibold text-brand-700 hover:underline">
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-6 grid gap-4 lg:hidden">
              {page.data.items.map((account) => (
                <li key={account.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900">{account.displayName}</p>
                      <p className="mt-0.5 text-sm break-all text-neutral-600">{account.email}</p>
                    </div>
                    <span className="font-mono text-xs text-neutral-400">#{account.id}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Roles roles={account.roles} />
                    <Status account={account} />
                    <Mfa account={account} />
                  </div>
                  <dl className="mt-3 grid gap-1 text-xs text-neutral-600">
                    <div className="flex justify-between gap-2"><dt>Last login</dt><dd>{formatWhen(account.lastLoginAt)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Created</dt><dd>{formatWhen(account.createdAt)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Password changed</dt><dd>{formatWhen(account.passwordChangedAt)}</dd></div>
                  </dl>
                  <Link href={`/super-admin/admins/${account.id}`} className="mt-3 inline-block font-semibold text-brand-700 hover:underline">
                    Manage
                  </Link>
                </li>
              ))}
            </ul>

            {page.data.totalPages > 1 ? (
              <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-3">
                <p className="text-sm text-neutral-600">
                  Page {page.data.page} of {page.data.totalPages} &middot; {page.data.total} account
                  {page.data.total === 1 ? "" : "s"}
                </p>
                <div className="flex gap-2">
                  <PageLink filters={filters} to={page.data.page - 1} disabled={page.data.page <= 1}>
                    Previous
                  </PageLink>
                  <PageLink filters={filters} to={page.data.page + 1} disabled={page.data.page >= page.data.totalPages}>
                    Next
                  </PageLink>
                </div>
              </nav>
            ) : null}
          </>
        ) : null}

        {/* The quick controls stay on this page for the row you are looking at: roles, status and
            clearing an authenticator are one click each, and sending somebody to a detail page to
            toggle a status would be worse. Everything heavier is behind Manage. */}
        {page.ok && roles.ok && page.data.items.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-lg font-bold text-neutral-900">Quick changes</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Roles, access and authenticators for the accounts on this page.
            </p>
            <ul className="mt-4 grid gap-4">
              {page.data.items.map((account) => (
                <li key={account.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <p className="font-semibold text-neutral-900">
                    {account.displayName}{" "}
                    <span className="font-normal text-neutral-500">&middot; {account.email}</span>
                  </p>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <RolesForm adminId={account.id} roles={account.roles} allRoles={roles.data} />
                    <StatusForm adminId={account.id} status={account.status} />
                    <ResetMfaForm adminId={account.id} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </SuperAdminChrome>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "good" | "accent" | "muted" }) {
  const accent =
    tone === "good" ? "text-green-700" : tone === "accent" ? "text-brand-700" : tone === "muted" ? "text-neutral-500" : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-neutral-600 uppercase">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <label>
      <span className="block text-xs font-semibold tracking-wide text-neutral-600 uppercase">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      >
        {options.map(([slug, text]) => (
          <option key={slug} value={slug}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const pill = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

function Roles({ roles }: { roles: string[] }) {
  if (roles.length === 0) return <span className="text-xs text-neutral-500">No role</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <span
          key={role}
          className={`${pill} ${role === "super_admin" ? "bg-brand-100 text-brand-800" : "bg-neutral-100 text-neutral-700"}`}
        >
          {role === "super_admin" ? "Super Admin" : "Admin"}
        </span>
      ))}
    </span>
  );
}

function Status({ account }: { account: AdminRow }) {
  const tone =
    account.status === "active"
      ? "bg-green-100 text-green-800"
      : account.status === "disabled"
        ? "bg-neutral-200 text-neutral-700"
        : "bg-amber-100 text-amber-900";
  return (
    <span className="flex flex-wrap gap-1">
      <span className={`${pill} ${tone}`}>{account.status}</span>
      {account.locked ? <span className={`${pill} bg-red-100 text-red-800`}>locked</span> : null}
      {account.mustChangePassword ? (
        <span className={`${pill} bg-amber-100 text-amber-900`}>must change password</span>
      ) : null}
    </span>
  );
}

function Mfa({ account }: { account: AdminRow }) {
  return account.mfaEnrolled ? (
    <span className="text-xs text-neutral-700">
      <span className={`${pill} bg-green-100 text-green-800`}>enrolled</span>
      <span className="mt-1 block text-neutral-500">{account.unusedRecoveryCodes} codes left</span>
    </span>
  ) : (
    <span className={`${pill} bg-amber-100 text-amber-900`}>not set up</span>
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
      <span className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-400">
        {children}
      </span>
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
    <Link
      href={`/super-admin/admins${suffix ? `?${suffix}` : ""}`}
      className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
    >
      {children}
    </Link>
  );
}
