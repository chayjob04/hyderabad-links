import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/AccessDenied";
import { Pagination } from "@/components/Pagination";
import { EmptyState, FilterTabs } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import { ConfirmButton } from "@/components/ConfirmButton";
import {
  PERMISSION_PLANS_MANAGE,
  formatWhen,
  getProfile,
  listSubscriptions,
  rupees,
  type PlanRow,
  type SubscriptionRow,
} from "@/lib/super-admin-api";
import { changePlanAction, extendAction, grantAction, revokeAction } from "./actions";

export const metadata: Metadata = { title: "Subscription management" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ state?: string; page?: string; done?: string; error?: string }> };

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
 * <b>What it writes, and what it will not.</b> A period can be granted, extended, moved to another
 * plan, or ended (S0033) -- each with a reason that is stored on the subscription and read months
 * later, and each in the audit log with the state before and after. What it never does is touch a
 * payment: a granted period is a subscription with no payment behind it, which is what `source`
 * records, and the figures above count those apart from the paid ones so a gift is never read as
 * revenue. Ending a period somebody *paid* for is refused by the API, because that is a refund and
 * refunds are a Razorpay operation this project does not perform. The note at the foot says so.
 *
 * Expiry is a comparison against the clock, done by the view. A period that ran out an hour ago
 * reads as lapsed here, with no job having run and nothing to go stale.
 */
export default async function SubscriptionsPage({ searchParams }: Props) {
  const { state, page: rawPage, done, error } = await searchParams;
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

      {/* The figures first: how many are paid up, how many run out this month, and what has come
          in. Each is counted in the same statement, so they cannot disagree with each other. */}
      {summary ? (
        <div className="row g-3 mb-1">
          {[
            { label: "Verified now", value: String(summary.verified), hint: `of ${summary.listings} listings` },
            { label: "Expiring in 30 days", value: String(summary.expiring), hint: "needs a renewal" },
            { label: "Lapsed", value: String(summary.lapsed), hint: "paid once, not now" },
            /* Counted apart from "Verified now" on purpose: how many listings are Verified and how
               many are paying are different questions, and the second one pays for the platform. */
            { label: "Complimentary", value: String(summary.complimentary), hint: "granted, not paid" },
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
                          {mayManage ? <th scope="col">Change it</th> : null}
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
                              {row.source === "complimentary" ? (
                                <span
                                  className="d-block badge bg-info-subtle text-info mt-1"
                                  title={row.grantReason ?? undefined}
                                >
                                  granted{row.grantedBy ? ` by ${row.grantedBy}` : ""}
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
                            {mayManage ? (
                              <td className="py-3">
                                <SubscriptionActions row={row} plans={plans} />
                              </td>
                            ) : null}
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
            <h5 className="alert-heading font-size-14">What these actions do, and what they do not</h5>
            <p className="mb-2 font-size-13">
              Granting or extending a period gives a listing the plan&apos;s benefits and{" "}
              <strong>records no payment</strong>, because none was taken. Those periods are marked
              as granted, counted separately above, and carry the reason you type. A payment reaches
              a listing one way only: the owner pays through the checkout on their own listing, and
              the provider&apos;s signed webhook grants the period.
            </p>
            <p className="mb-2 font-size-13">
              Ending a period that was <strong>paid for</strong> is refused. That would be a refund,
              and refunds are done in Razorpay &mdash; nothing here touches payment records.
            </p>
            <p className="mb-0 font-size-13">
              A price change is an <code>UPDATE</code> on the <code>plans</code> table &mdash; every
              page that quotes a price reads it, so nothing needs deploying. Every action on this
              screen is in the audit log with who, when, why, and the state before and after.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The four things that can be done to one listing's subscription.
 *
 * Which ones are offered depends on what the listing has, because the API refuses the rest and a
 * control that always fails is worse than no control: a listing with no period can only be granted
 * one, a listing with one can be extended or moved, and only a *granted* period can be ended --
 * ending a paid one would be a refund.
 *
 * Every form carries a reason. It is required by the API, stored on the subscription, and read on
 * this screen months later when somebody asks why a business is Verified.
 */
function SubscriptionActions({ row, plans }: { row: SubscriptionRow; plans: PlanRow[] }) {
  const sellable = plans.filter((plan) => plan.isActive && plan.pricePaise > 0);
  const live = row.paidUntil !== null && (row.daysRemaining ?? -1) >= 0;

  if (!live) {
    return (
      <form action={grantAction.bind(null, row.listingId, row.url)} className="d-grid gap-1">
        <div className="d-flex gap-1">
          <select name="planSlug" className="form-select form-select-sm" style={{ width: "7rem" }}>
            {sellable.map((plan) => (
              <option key={plan.slug} value={plan.slug}>
                {plan.name}
              </option>
            ))}
          </select>
          <input
            name="months"
            type="number"
            min={1}
            max={24}
            defaultValue={12}
            aria-label="Months"
            className="form-control form-control-sm"
            style={{ width: "4.5rem" }}
          />
        </div>
        <input
          name="reason"
          maxLength={1000}
          required
          placeholder="Why (stored with it)"
          aria-label="Reason"
          className="form-control form-control-sm"
        />
        <ConfirmButton
          label="Grant"
          title="Grant this plan without a payment?"
          subject={row.listingName}
          confirmLabel="Grant it"
          tone="archive"
          className="btn btn-sm btn-outline-primary"
        >
          <p>
            This listing gets the plan&apos;s benefits straight away. <strong>No payment is
            recorded</strong>, because none was taken: the period is marked as granted and your
            reason is stored with it.
          </p>
        </ConfirmButton>
      </form>
    );
  }

  return (
    <div className="d-grid gap-2">
      <form action={extendAction.bind(null, row.listingId, row.url)} className="d-grid gap-1">
        <div className="d-flex gap-1">
          <input
            name="months"
            type="number"
            min={1}
            max={24}
            defaultValue={1}
            aria-label="Months to add"
            className="form-control form-control-sm"
            style={{ width: "4.5rem" }}
          />
          <input
            name="reason"
            maxLength={1000}
            required
            placeholder="Why"
            aria-label="Reason"
            className="form-control form-control-sm"
          />
        </div>
        <ConfirmButton
          label="Add time"
          title="Add to this period?"
          subject={row.listingName}
          confirmLabel="Add it"
          tone="archive"
          className="btn btn-sm btn-outline-secondary"
        >
          <p>
            The months are added to what is left, not to today. <strong>No payment is
            recorded</strong>; if this period was paid for, the money taken stays exactly as it is.
          </p>
        </ConfirmButton>
      </form>

      {/* Moving between plans, offered only when there is somewhere to move to. */}
      {plans.filter((plan) => plan.isActive && plan.slug !== row.effectivePlanSlug).length > 0 ? (
        <form action={changePlanAction.bind(null, row.listingId, row.url)} className="d-grid gap-1">
          <div className="d-flex gap-1">
            <select name="planSlug" className="form-select form-select-sm" style={{ width: "7rem" }}>
              {plans
                .filter((plan) => plan.isActive && plan.slug !== row.effectivePlanSlug)
                .map((plan) => (
                  <option key={plan.slug} value={plan.slug}>
                    {plan.name}
                  </option>
                ))}
            </select>
            <input
              name="reason"
              maxLength={1000}
              required
              placeholder="Why"
              aria-label="Reason"
              className="form-control form-control-sm"
            />
          </div>
          <ConfirmButton
            label="Move plan"
            title="Move this period to another plan?"
            subject={row.listingName}
            confirmLabel="Move it"
            tone="archive"
            className="btn btn-sm btn-outline-secondary"
          >
            <p>
              The dates do not change; what the listing may show does, from the moment you confirm.
              {row.source === "payment"
                ? " This period was paid for, so moving it to a cheaper plan takes away something the business bought."
                : ""}
            </p>
          </ConfirmButton>
        </form>
      ) : null}

      {/* Ending one. Offered only for a granted period: the API refuses a paid one, because that
          would be a refund. */}
      {row.source === "complimentary" ? (
        <form action={revokeAction.bind(null, row.listingId, row.url)} className="d-grid gap-1">
          <input
            name="reason"
            maxLength={1000}
            required
            placeholder="Why it is ending"
            aria-label="Reason"
            className="form-control form-control-sm"
          />
          <ConfirmButton
            label="End it"
            title="End this granted period now?"
            subject={row.listingName}
            confirmLabel="End it"
            className="btn btn-sm btn-outline-danger"
          >
            <p>
              The listing reads as Free from the next page load. Nothing is deleted: its photos and
              links are kept and simply stop being shown, and the record of what was granted stays.
            </p>
          </ConfirmButton>
        </form>
      ) : null}
    </div>
  );
}
