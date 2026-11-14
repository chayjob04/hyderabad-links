import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { PageTitle } from "@/components/minia/PageTitle";
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
  grey: "bg-secondary-subtle text-secondary",
  amber: "bg-warning-subtle text-warning",
  green: "bg-success-subtle text-success",
  red: "bg-danger-subtle text-danger",
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
 *
 * Laid out as a narrow identity column beside a wide listings table: the four facts about the
 * person are short and fixed, and the list of what they own is the part that grows.
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
      <>
        <PageTitle title="Account" breadcrumb={[{ label: "Business accounts", href: "/super-admin/accounts" }]} />
        <div role="alert" className="alert alert-danger">
          {result.message}
        </div>
      </>
    );
  }

  const { account, listings } = result.data;
  const suspended = account.status === "suspended";

  return (
    <>
      <PageTitle
        title={account.name?.trim() || account.phoneE164}
        breadcrumb={[
          { label: "Business accounts", href: "/super-admin/accounts" },
          { label: `#${account.id}` },
        ]}
        action={
          <Link href="/super-admin/accounts" className="btn btn-outline-secondary">
            <i className="mdi mdi-arrow-left me-1" /> All accounts
          </Link>
        }
      />

      {done ? (
        <div role="status" className="alert alert-success">
          {done}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      ) : null}

      <div className="row g-3">
        <div className="col-xl-4">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex align-items-center mb-3">
                <div className="avatar-sm me-3">
                  <span className="avatar-title bg-primary-subtle text-primary rounded-circle font-size-20">
                    <i className="bx bx-user" />
                  </span>
                </div>
                <div className="flex-grow-1 min-w-0">
                  <h5 className="font-size-15 mb-1">{account.name?.trim() || "No name given"}</h5>
                  <span
                    className={`badge ${
                      suspended ? "bg-danger-subtle text-danger" : "bg-success-subtle text-success"
                    }`}
                  >
                    {account.status}
                  </span>
                </div>
              </div>

              {/* A compact definition table rather than a two-column card grid: four short facts
                  read faster stacked with their labels than spread across a wide panel. */}
              <table className="table table-sm mb-3">
                <tbody>
                  <tr>
                    <th scope="row" className="fw-normal text-muted ps-0">
                      Phone
                    </th>
                    <td className="text-end pe-0">
                      {account.phoneE164}
                      {account.phoneVerified ? null : (
                        <span className="badge bg-warning-subtle text-warning ms-2">Unverified</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="fw-normal text-muted ps-0">
                      Email
                    </th>
                    <td className="text-end pe-0 text-break">{account.email ?? "—"}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="fw-normal text-muted ps-0">
                      Joined
                    </th>
                    <td className="text-end pe-0">{formatWhen(account.createdAt)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="fw-normal text-muted ps-0">
                      Listings
                    </th>
                    <td className="text-end pe-0 fw-semibold">{account.listingCount}</td>
                  </tr>
                </tbody>
              </table>

              <p className="text-muted font-size-12 mb-0">
                The name, email and phone belong to the account holder and are edited by them. Staff
                cannot change them here, and there is no way to sign in as somebody.
              </p>

              {maySuspend ? (
                <div className="border-top mt-3 pt-3">
                  <h5 className="font-size-14 mb-1">
                    {suspended ? "Reinstate" : "Suspend"} this account
                  </h5>
                  <p className="text-muted font-size-12">
                    {suspended
                      ? "They will be able to sign in again. Their listings are unaffected by this — whatever status each one is in now is what it stays."
                      : "They will not be able to sign in. Their listings keep their own status, so anything live stays live — use the listing screens to take a business off the site."}
                  </p>
                  <form action={setAccountStatusAction.bind(null, id, suspended ? "active" : "suspended")}>
                    <button
                      type="submit"
                      className={`btn btn-sm ${suspended ? "btn-primary" : "btn-outline-danger"}`}
                    >
                      {suspended ? "Reinstate account" : "Suspend account"}
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="col-xl-8">
          <div className="card h-100">
            <div className="card-body">
              <h4 className="card-title mb-1">Their listings</h4>
              <p className="card-title-desc mb-3">
                {listings.length} {listings.length === 1 ? "business" : "businesses"} on this
                account.
              </p>

              {listings.length === 0 ? (
                <p className="text-muted font-size-13 mb-0">None.</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col">Listing</th>
                        <th scope="col">Area</th>
                        <th scope="col" className="text-center" style={{ width: "10rem" }}>
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {listings.map((listing) => {
                        const tone = describeStatus(listing.status);
                        return (
                          <tr key={listing.id}>
                            <td className="py-3">
                              <Link
                                href={`/super-admin/listings/${listing.id}`}
                                className="fw-semibold text-body"
                              >
                                {listing.name}
                              </Link>
                            </td>
                            <td className="py-3 text-muted">{listing.localityName}</td>
                            <td className="py-3 text-center">
                              <span className={`badge ${TONES[tone.tone] ?? TONES.grey}`}>
                                {tone.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
