import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPageMeta, getPublicPlans, withPageMeta } from "@/lib/api";
import { BRAND_NAME } from "@/lib/brand";
import { absoluteUrl, rupees } from "@/lib/format";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const applied = withPageMeta(
    {
      title: "Pricing",
      description: `List your business on ${BRAND_NAME} free, or take the Verified plan for a badge, photos, videos and links.`,
    },
    await getPageMeta("static", "pricing"),
  );

  return { ...applied, alternates: { canonical: absoluteUrl("/pricing") } };
}

/** What each plan gets, in the order a business owner cares about it. */
function features(plan: {
  grantsVerifiedBadge: boolean;
  photoLimit: number;
  videoLimit: number;
  logoLimit: number;
  linkLimit: number;
  faqLimit: number;
  contentSectionLimit: number;
}): { text: string; included: boolean }[] {
  return [
    { text: "Your business found by name, category and area", included: true },
    { text: "Customers call or WhatsApp you directly", included: true },
    { text: "Enquiries in your dashboard", included: true },
    { text: "Opening hours and Open now", included: true },
    { text: "Verified badge on your page", included: plan.grantsVerifiedBadge },
    {
      text: plan.logoLimit > 0 ? "A logo" : "No logo",
      included: plan.logoLimit > 0,
    },
    {
      text: plan.photoLimit > 0 ? `Up to ${plan.photoLimit} photos` : "No photos",
      included: plan.photoLimit > 0,
    },
    {
      text: plan.videoLimit > 0 ? `Up to ${plan.videoLimit} videos` : "No videos",
      included: plan.videoLimit > 0,
    },
    {
      text: plan.linkLimit > 0 ? `Website and social links (${plan.linkLimit})` : "No website or social links",
      included: plan.linkLimit > 0,
    },
    {
      text: plan.faqLimit > 0 ? `Up to ${plan.faqLimit} questions and answers` : "No questions and answers",
      included: plan.faqLimit > 0,
    },
    {
      text:
        plan.contentSectionLimit > 0
          ? `Up to ${plan.contentSectionLimit} description sections`
          : "No description sections",
      included: plan.contentSectionLimit > 0,
    },
  ];
}

/**
 * What a listing costs.
 *
 * Every number on this page is read from the `plans` table. Nothing here writes 399 into the
 * markup, so the day the price changes this page changes with it — and it cannot quietly disagree
 * with what the checkout actually charges.
 *
 * The free plan is shown as a real option rather than a lead-in, because it is one: most listings
 * will never pay, and a directory that only lists paying businesses is a worse directory.
 */
export default async function PricingPage() {
  const plans = await getPublicPlans();

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <div className="text-center">
        <p className="text-[11px] font-black tracking-[0.22em] text-muted">LIST YOUR BUSINESS</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-brand-800 sm:text-4xl">
          Simple pricing
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Being listed is free. The Verified plan adds everything that helps somebody choose you
          over the shop next door.
        </p>
      </div>

      {plans.length === 0 ? (
        <div className="mt-10">
          <EmptyState tone="error" mark="&#9888;" title="We could not load our plans">
            <p>Please try again in a moment.</p>
          </EmptyState>
        </div>
      ) : (
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {plans.map((plan) => {
            const paid = plan.pricePaise > 0;
            return (
              <section
                key={plan.slug}
                className={`rounded-2xl border p-6 shadow-[0_8px_28px_#002a3412] sm:p-8 ${
                  paid ? "border-amber-300 bg-gradient-to-b from-amber-50/60 to-white" : "border-line bg-white"
                }`}
              >
                {paid ? (
                  <p className="mb-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black tracking-wider text-amber-900">
                    MOST USEFUL
                  </p>
                ) : null}

                <h2 className="text-xl font-black text-brand-800">{plan.name} Listing</h2>
                <p className="mt-2">
                  <span className="text-4xl font-black text-ink">{rupees(plan.pricePaise)}</span>
                  <span className="ml-1 text-sm font-bold text-muted">{paid ? "a year" : "forever"}</span>
                </p>

                <ul className="mt-6 grid gap-2.5">
                  {features(plan).map((feature) => (
                    <li key={feature.text} className="flex items-start gap-2.5 text-[15px]">
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 shrink-0 font-black ${feature.included ? "text-green-700" : "text-neutral-300"}`}
                      >
                        {feature.included ? "✓" : "—"}
                      </span>
                      <span className={feature.included ? "text-ink" : "text-muted"}>{feature.text}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-7">
                  <ButtonLink tone={paid ? "cta" : "ghost"} href="/account/listings/new">
                    {paid ? "Add your business" : "Start free"}
                  </ButtonLink>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <section className="mt-12 rounded-2xl border border-line bg-brand-50/50 p-6 sm:p-8">
        <h2 className="text-lg font-black text-brand-800">Questions</h2>
        <dl className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="font-black text-ink">Is there a contract?</dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted">
              No. The Verified plan runs for a year. If you do not renew, your listing stays on the
              site as a free listing.
            </dd>
          </div>
          <div>
            <dt className="font-black text-ink">What happens to my photos if I stop paying?</dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted">
              They are kept, not deleted. They stop being shown, and they come back the moment you
              renew.
            </dd>
          </div>
          <div>
            <dt className="font-black text-ink">Can I pay for one business and not another?</dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted">
              Yes. Each listing has its own plan, so you can pay for the ones that need it.
            </dd>
          </div>
          <div>
            <dt className="font-black text-ink">How do I pay?</dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted">
              Card, UPI or netbanking through Razorpay. Your card details are entered in their
              window and never reach {BRAND_NAME}.
            </dd>
          </div>
        </dl>
      </section>

      <p className="mt-8 text-center text-sm text-muted">
        Still deciding?{" "}
        <Link href="/about" className="font-bold text-brand-700 hover:underline">
          Read about {BRAND_NAME}
        </Link>
        .
      </p>
    </main>
  );
}
