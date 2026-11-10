import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getMe, getOverview } from "@/lib/owner-api";

export const metadata: Metadata = { title: "Overview" };

/**
 * The dashboard's front page.
 *
 * Every figure comes from GET /api/v1/me/overview, which counts the owner's own rows. There is no
 * card here for views, leads, enquiries, ratings or growth: no table records any of them, and a
 * dashboard that invents numbers is worse than one that shows fewer.
 */

type Stat = { label: string; value: number; href?: string; hint?: string };

function StatCard({ label, value, href, hint }: Stat) {
  const body = (
    <>
      <p className="text-xs font-black tracking-[0.12em] text-muted uppercase">{label}</p>
      <p className="mt-2 text-3xl font-black text-ink">{value}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </>
  );

  const shell = "rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]";
  return href ? (
    <Link href={href} className={`${shell} block transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_#002a3417]`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

export default async function OverviewPage() {
  /* This dashboard counts a business owner's own rows. Everyone here signed in on the business tab,
     which is a separate account from a customer's, so an account with nothing to count is one that
     has not finished registering its business — and /onboarding is where that is asked for. */
  const me = await getMe();
  if (me.ok && me.data.needsOnboarding) redirect("/onboarding");

  const result = await getOverview();

  if (!result.ok) {
    return (
      <>
        <h1 className="text-2xl font-black text-ink">Overview</h1>
        <div className="mt-5">
          <EmptyState mark="!" title="We could not load your dashboard" tone="error">
            <p>{result.message}</p>
            <p className="mt-1">Your listings are unaffected. Please refresh in a moment.</p>
          </EmptyState>
        </div>
      </>
    );
  }

  const { listings, profile } = result.data;
  const percent = profile.total > 0 ? Math.round((profile.completed / profile.total) * 100) : 0;

  // Suspended listings are rare, so the card only appears when there is one to report.
  const stats: Stat[] = [
    { label: "Total listings", value: listings.total, href: "/account/listings" },
    { label: "Live", value: listings.active, href: "/account/listings", hint: "Visible on the site" },
    { label: "In review", value: listings.pendingReview, href: "/account/listings", hint: "Waiting for a decision" },
    { label: "Drafts", value: listings.draft, href: "/account/listings", hint: "Only you can see these" },
    { label: "Needs changes", value: listings.rejected, href: "/account/listings", hint: "Fix and resubmit" },
    ...(listings.suspended > 0
      ? [{ label: "Suspended", value: listings.suspended, href: "/account/listings", hint: "Hidden — contact support" }]
      : []),
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black text-ink">Overview</h1>
        <ButtonLink href="/account/listings/new" tone="primary">
          Add a listing
        </ButtonLink>
      </div>

      {listings.total === 0 ? (
        <div className="mt-6">
          <EmptyState
            mark="+"
            title="You have not added a business yet"
            action={<ButtonLink href="/account/listings/new">Create your first listing</ButtonLink>}
          >
            <p>It takes a few minutes. Customers nearby will be able to call or WhatsApp you directly.</p>
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      )}

      <section aria-labelledby="completion" className="mt-8 rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="completion" className="text-lg font-black text-ink">
            Profile completion
          </h2>
          <p className="text-sm font-bold text-brand-700">
            {profile.completed} of {profile.total} done
          </p>
        </div>

        {/* A plain meter: the number is the point, not the decoration. */}
        <div
          role="progressbar"
          aria-valuenow={profile.completed}
          aria-valuemin={0}
          aria-valuemax={profile.total}
          aria-labelledby="completion"
          className="mt-3 h-2 overflow-hidden rounded-full bg-brand-50"
        >
          <div className="h-full rounded-full bg-brand-700" style={{ width: `${percent}%` }} />
        </div>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {profile.steps.map((step) => (
            <li key={step.key} className="flex items-start gap-2.5 text-sm">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-black ${
                  step.done ? "bg-brand-700 text-white" : "border border-line bg-white text-muted"
                }`}
              >
                {step.done ? "✓" : ""}
              </span>
              <span className={step.done ? "text-muted line-through" : "font-medium text-ink"}>{step.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
