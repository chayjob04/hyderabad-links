import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/AccessDenied";
import { Pagination } from "@/components/Pagination";
import { EmptyState, FilterTabs } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_PLANS_MANAGE,
  formatWhen,
  getProfile,
  listSubscriptions,
  rupees,
} from "@/lib/super-admin-api";

export const metadata: Metadata = { title: "Subscription management" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ state?: string; page?: string }> };

const TABS = [
  { value: "all", label: "All listings" },
  { value: "verified", label: "Verified now" },
  { value: "expiring", label: "Expiring in 30 days" },
  { value: "lapsed", label: "Lapsed" },
  { value: "free", label: "Never paid" },
] as const;

/**
 * Subscription management: every listing's plan, when it runs out, and what has been taken.
 *
 * Everything a subscription needs already existed — the plans table, the subscriptions table, the
 * payments table, and the entitlement view that decides whether a listing is paid up right now.
 * What did not exist was any way for the platform owner to look at it: an owner could see their own
 * listing's plan, and nobody could see the whole picture without querying production.
 *
 * <b>Nothing here writes.</b> There is no endpoint to grant a plan, extend a period, change a price
 * or refund a payment, so there is no button for one. That is a decision rather than an omission:
 * each of those is money, and this project does not change payment behaviour without the owner
 * saying so. The note at the foot says what each would take, so nobody hunts for a control that was
 * quietly left out.
 *
 * Expiry is a comparison against the clock, done by the view. A period that ran out an hour ago
 * reads as lapsed here, with no job having run and nothing to go stale.
 */
export default async function SubscriptionsPage({ searchParams }: Props) {
  const { state, page: rawPage } = await searchParams;
  const parsed = Number.parseInt(rawPage ?? "1", 10);
  const currentPage = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
  const wanted = TABS.some((tab) => tab.value === state) ? state! : "all";

  const [result, me] = await Promise.all([
    listSubscriptions({ state: wanted, page: currentPage }),
    getProfile(),
  ]);
  const mayManage = me.ok && me.data.permissions.includes(PERMISSION_PLANS_MANAGE);

  if (me.ok && !mayManage) {
    return <AccessDenied surface="super" permission={PERMISSION_PLANS_MANAGE} what="subscriptions" />;
  }

  const summary = result.ok ? result.data.summary : null;
  const plans = result.ok ? result.data.plans : [];

  return (
    <>
      <PageTitle
        title="Subscription management"
        breadcrumb={[{ label: "Subscriptions" }, { label: "Plans and periods" }]}
      />

      {/* The figures first: how many are paid up, how many run out this month, and what has come
          in. Each is counted in the same statement, so they cannot disagree with each other. */}
      {summary ? (
        <div className="row g-3 mb-1">
          {[
            { label: "Verified now", value: String(summary.verified), hint: `of ${summary.listings} listings` },
            { label: "Expiring in 30 days", value: String(summary.expiring), hint: "needs a renewal" },
            { label: "Lapsed", value: String(summary.lapsed), hint: "paid once, not now" },
            { label: "Taken, last 30 days", value: rupees(summary.paidPaiseLast30Days), hint: `${rupees(summary.paidPaiseAllTime)} all time` },
          ].map((tile) => (
            <div key={tile.label} className="col-md-6 col-xl-3">
              <div className="card mb-0">
                <div className="card-body">
                  <p className="text-muted font-size-13 mb-1">{tile.label}</p>
                  <h4 className="mb-1">{tile.value}</h4>
                  <p className="text-muted font-size-12 mb-0">{tile.hint}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="row g-3 mt-2">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Listings and their plans</h4>
              <p className="card-title-desc mb-3">
                Soonest to run out first. A listing reads as free from the moment its period ends,
                which is worked out when this page loads rather than stored.
              </p>

              <FilterTabs
                tabs={TABS}
                current={wanted}
                hrefFor={(value) => `/super-admin/subscriptions?state=${value}`}
                label="Filter by plan state"
              />

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.message}
                </div>
              ) : result.data.items.length === 0 ? (
                <EmptyState icon="bx bx-receipt" title="Nothing in this list">
                  No listing is in that state right now.
                </EmptyState>
              ) : (
                <>
                  <p className="text-muted font-size-13">
                    {result.data.total} {result.data.total === 1 ? "listing" : "listings"}
                  </p>

                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Listing</th>
                          <th scope="col">Plan now</th>
                          <th scope="col">Runs out</th>
                          <th scope="col">Last payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.items.map((row) => (
                          <tr key={row.listingId}>
                            <td className="py-3">
                              <Link
                                href={`/super-admin/listings/${row.listingId}`}
                                className="fw-semibold text-body"
                              >
                                {row.listingName}
                              </Link>
                              <span className="d-block text-muted font-size-12">
                                {row.localityName} &middot; {row.listingStatus}
                                {row.ownerPhone ? <> &middot; {row.ownerPhone}</> : null}
                              </span>
                            </td>
                            <td className="py-3">
                              <span
                                className={`badge ${
                                  row.verified ? "bg-success-subtle text-success" : "bg-secondary-subtle text-secondary"
                                }`}
                              >
                                {row.effectivePlanName}
                              </span>
                              {/* What it bought, when that is no longer what it has. */}
                              {!row.verified && row.subscribedPlanSlug !== row.effectivePlanSlug ? (
                                <span className="d-block text-muted font-size-12">
                                  had {row.subscribedPlanSlug}
                                </span>
                              ) : null}
                            </td>
                            <td className="py-3 text-nowrap">
                              {row.paidUntil ? (
                                <>
                                  <span className="font-size-13">{formatWhen(row.paidUntil)}</span>
                                  <span
                                    className={`d-block font-size-12 ${
                                      (row.daysRemaining ?? 0) < 0
                                        ? "text-danger"
                                        : (row.daysRemaining ?? 0) <= 30
                                          ? "text-warning"
                                          : "text-muted"
                                    }`}
                                  >
                                    {row.daysRemaining === null
                                      ? null
                                      : row.daysRemaining < 0
                                        ? `${Math.abs(row.daysRemaining)} days ago`
                                        : `${row.daysRemaining} days left`}
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted font-size-13">&mdash;</span>
                              )}
                            </td>
                            <td className="py-3">
                              {row.lastPaymentAt ? (
                                <>
                                  <span className="font-size-13">
                                    {row.lastPaymentPaise !== null ? rupees(row.lastPaymentPaise) : null}{" "}
                                    <span
                                      className={`badge ${
                                        row.lastPaymentStatus === "paid"
                                          ? "bg-success-subtle text-success"
                                          : row.lastPaymentStatus === "refunded"
                                            ? "bg-warning-subtle text-warning"
                                            : row.lastPaymentStatus === "failed"
                                              ? "bg-danger-subtle text-danger"
                                              : "bg-secondary-subtle text-secondary"
                                      }`}
                                    >
                                      {row.lastPaymentStatus}
                                    </span>
                                  </span>
                                  <span className="d-block text-muted font-size-12">
                                    {formatWhen(row.lastPaymentAt)}
                                    {row.lastPaymentReference ? <> &middot; {row.lastPaymentReference}</> : null}
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted font-size-13">never</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    page={result.data.page}
                    totalPages={result.data.totalPages}
                    params={{ state: wanted }}
                    basePath="/super-admin/subscriptions"
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* The plans themselves, as the table has them. Every tier, including one nobody may buy any
          more: a listing can still be sitting on it, and hiding it here would make those listings
          unaccountable. */}
      {plans.length > 0 ? (
        <div className="row g-3 mt-2">
          <div className="col-12">
            <div className="card mb-0">
              <div className="card-body">
                <h4 className="card-title mb-1">Plans on offer</h4>
                <p className="card-title-desc mb-3">
                  The price and the allowances as the database holds them. Every page that quotes a
                  price reads these rows, so nothing here is written into the code.
                </p>

                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col">Plan</th>
                        <th scope="col">Price</th>
                        <th scope="col">Photos</th>
                        <th scope="col">Videos</th>
                        <th scope="col">Logo</th>
                        <th scope="col">Q&amp;A</th>
                        <th scope="col">Sections</th>
                        <th scope="col">Badge</th>
                        <th scope="col" className="text-end">
                          Listings
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((plan) => (
                        <tr key={plan.slug}>
                          <td className="py-2">
                            <span className="fw-semibold">{plan.name}</span>
                            <span className="d-block text-muted font-size-12">
                              {plan.slug}
                              {!plan.isActive ? (
                                <span className="badge bg-secondary-subtle text-secondary ms-2">
                                  not on sale
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="py-2">{plan.pricePaise === 0 ? "Free" : rupees(plan.pricePaise)}</td>
                          <td className="py-2">{plan.photoLimit}</td>
                          <td className="py-2">{plan.videoLimit}</td>
                          <td className="py-2">{plan.logoLimit}</td>
                          <td className="py-2">{plan.faqLimit}</td>
                          <td className="py-2">{plan.contentSectionLimit}</td>
                          <td className="py-2">
                            {plan.grantsVerifiedBadge ? (
                              <span className="badge bg-success-subtle text-success">Verified</span>
                            ) : (
                              <span className="text-muted">&mdash;</span>
                            )}
                          </td>
                          <td className="py-2 text-end">{plan.listingsOnPlan}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {plans.some((plan) => !plan.mediaLimitsConfirmed) ? (
                  <p className="text-muted font-size-12 mt-3 mb-0">
                    A plan whose allowances are still provisional is marked as such in the database
                    (<code>media_limits_confirmed</code>), and the owner&apos;s screens avoid
                    presenting those numbers as a promise.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Said once, here, rather than implied by the absence of buttons. */}
      <div className="row g-3 mt-2">
        <div className="col-12">
          <div className="alert alert-info mb-0" role="note">
            <h5 className="alert-heading font-size-14">This screen reads; it does not charge</h5>
            <p className="mb-2 font-size-13">
              Granting a plan without a payment, extending a period, changing a price or refunding
              are all money, so none of them has an endpoint. A payment reaches a listing one way
              only: the owner pays through the checkout on their own listing, and the provider&apos;s
              signed webhook grants the period.
            </p>
            <p className="mb-0 font-size-13">
              A price change is an <code>UPDATE</code> on the <code>plans</code> table &mdash; every
              page that quotes a price reads it, so nothing needs deploying. Anything beyond that
              needs to be asked for, and built with an audit trail.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
