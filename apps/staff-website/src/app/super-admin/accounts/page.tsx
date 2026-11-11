import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/AccessDenied";
import { PERMISSION_USERS_VIEW, formatWhen, getProfile, listAccounts } from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Business accounts" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

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

  /** The same search and filter, one page along. */
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    params.set("page", String(target));
    return `/super-admin/accounts?${params}`;
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      <h1 className="text-2xl font-bold">Business accounts</h1>
      <p className="mt-1 text-neutral-600">
        Everyone who owns at least one listing. Accounts that never finished signing in are not
        listed.
      </p>

      <form className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Name, email or phone"
          aria-label="Search accounts"
          className={INPUT}
        />
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={INPUT}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
        >
          Search
        </button>
      </form>

      {!result.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      ) : result.data.items.length === 0 ? (
        <p className="mt-6 rounded-lg bg-neutral-50 px-4 py-3 text-neutral-700">
          No accounts match that.
        </p>
      ) : (
        <>
          <p className="mt-5 text-sm text-neutral-600">
            {result.data.total} {result.data.total === 1 ? "account" : "accounts"}
          </p>

          <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-left">
              <thead className="bg-neutral-50 text-sm text-neutral-600">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Phone
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Listings
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Joined
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {result.data.items.map((account) => (
                  <tr key={account.id}>
                    <th scope="row" className="px-4 py-3 font-semibold">
                      <Link href={`/super-admin/accounts/${account.id}`} className="text-brand-700 hover:underline">
                        {/* An account can legitimately have no name: sign-in is by phone, and the
                            name is asked for later. The phone is the identity, so it stands in. */}
                        {account.name?.trim() || account.phoneE164}
                      </Link>
                      {account.email ? (
                        <p className="text-sm font-normal text-neutral-500">{account.email}</p>
                      ) : null}
                    </th>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {account.phoneE164}
                      {!account.phoneVerified ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                          UNVERIFIED
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{account.listingCount}</td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap text-neutral-600">
                      {formatWhen(account.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          account.status === "active" ?
                            "bg-green-50 text-green-800"
                          : "bg-red-50 text-red-800"
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

          {result.data.totalPages > 1 ? (
            <nav className="mt-6 flex items-center justify-between gap-4" aria-label="Pages">
              {currentPage > 1 ? (
                <Link href={pageHref(currentPage - 1)} className="font-semibold text-brand-700 hover:underline">
                  &larr; Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-neutral-600">
                Page {result.data.page} of {result.data.totalPages}
              </span>
              {currentPage < result.data.totalPages ? (
                <Link href={pageHref(currentPage + 1)} className="font-semibold text-brand-700 hover:underline">
                  Next &rarr;
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}
