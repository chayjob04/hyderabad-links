import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import {
  PERMISSION_ADMINS_MANAGE,
  PERMISSION_USERS_VIEW,
  describeStatus,
  formatWhen,
  getAccount,
  getProfile,
} from "@/lib/super-admin-api";
import { setAccountStatusAction } from "../actions";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> };

const TONES: Record<string, string> = {
  grey: "bg-neutral-100 text-neutral-700",
  amber: "bg-amber-50 text-amber-800",
  green: "bg-green-50 text-green-800",
  red: "bg-red-50 text-red-800",
};

/**
 * One business account and the listings it holds — the original's `Super/RegisterData/View` and
 * `Edit`, as one page.
 *
 * Two screens made no sense here, because there is exactly one thing staff may change: whether the
 * account is suspended. The name, email and phone belong to the person and are edited by them; an
 * admin form over someone else's contact details is a way for those details to quietly stop
 * matching reality.
 *
 * Suspending is gated on `admins.manage`, not the `users.view` that opens this page, and the
 * confirmation says what it does to their listings — because that is the part that is easy to
 * forget and hard to notice afterwards.
 */
export default async function AccountPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { done, error } = await searchParams;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [result, me] = await Promise.all([getAccount(id), getProfile()]);
  const mayView = me.ok && me.data.permissions.includes(PERMISSION_USERS_VIEW);
  const maySuspend = me.ok && me.data.permissions.includes(PERMISSION_ADMINS_MANAGE);

  if (me.ok && !mayView) {
    return <AccessDenied surface="super" permission={PERMISSION_USERS_VIEW} what="business accounts" />;
  }
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      </main>
    );
  }

  const { account, listings } = result.data;
  const suspended = account.status === "suspended";

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <Link href="/super-admin/accounts" className="text-sm font-semibold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> Business accounts
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">{account.name?.trim() || account.phoneE164}</h1>
        <span
          className={`rounded px-2.5 py-1 text-sm font-semibold ${
            suspended ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"
          }`}
        >
          {account.status}
        </span>
      </div>

      {done ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      ) : null}

      <dl className="mt-6 grid gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold text-neutral-600">Phone</dt>
          <dd className="mt-0.5">
            {account.phoneE164}
            {account.phoneVerified ? null : (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                UNVERIFIED
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-neutral-600">Email</dt>
          <dd className="mt-0.5">{account.email ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-neutral-600">Joined</dt>
          <dd className="mt-0.5">{formatWhen(account.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-neutral-600">Listings</dt>
          <dd className="mt-0.5">{account.listingCount}</dd>
        </div>
      </dl>

      <p className="mt-2 text-xs text-neutral-500">
        The name, email and phone belong to the account holder and are edited by them. Staff cannot
        change them here, and there is no way to sign in as somebody.
      </p>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Their listings</h2>
        {listings.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">None.</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white shadow-sm">
            {listings.map((listing) => {
              const tone = describeStatus(listing.status);
              return (
                <li key={listing.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Link
                    href={`/listings/${listing.id}`}
                    className="min-w-0 flex-1 font-semibold text-brand-700 hover:underline"
                  >
                    {listing.name}
                  </Link>
                  <span className="text-sm text-neutral-500">{listing.localityName}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${TONES[tone.tone] ?? TONES.grey}`}
                  >
                    {tone.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {maySuspend ? (
        <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">{suspended ? "Reinstate" : "Suspend"} this account</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {suspended ?
              "They will be able to sign in again. Their listings are unaffected by this — whatever status each one is in now is what it stays."
            : "They will not be able to sign in. Their listings keep their own status, so anything live stays live — use the listing screens to take a business off the site."}
          </p>
          <form action={setAccountStatusAction.bind(null, id, suspended ? "active" : "suspended")} className="mt-4">
            <button
              type="submit"
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white ${
                suspended ? "bg-neutral-900 hover:bg-neutral-700" : "bg-red-700 hover:bg-red-800"
              }`}
            >
              {suspended ? "Reinstate account" : "Suspend account"}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
