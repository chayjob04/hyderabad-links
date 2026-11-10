import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPublicPlans } from "@/lib/api";
import { BRAND_NAME } from "@/lib/brand";
import { absoluteUrl, rupees } from "@/lib/format";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "List your business",
  description: `Put your business in front of people searching their own area. Free to list on ${BRAND_NAME}, with a Verified plan for photos, links and the Verified badge.`,
  alternates: { canonical: absoluteUrl("/list-your-business") },
};

/**
 * The page between "I might list my business" and actually registering one.
 *
 * Every button on it goes to the *existing* business sign-in at /login?tab=business. There is no
 * form here, no account creation, no second way in: the one mobile-number-and-OTP sign-in already
 * creates the account and /onboarding already registers the business. This page only explains what
 * is on the other side of that door.
 *
 * Prices are read from the `plans` table, like /pricing does, so this page cannot quietly disagree
 * with what the checkout charges.
 */

/** Where every call to action on this page leads: the business tab of the one public sign-in. */
const REGISTER_HREF = "/login?tab=business";

const BENEFITS: { title: string; body: string; mark: string }[] = [
  {
    mark: "\u{1F4CD}",
    title: "Found in your own area",
    body: "Your listing sits under its category in its locality, so somebody searching that corner of Hyderabad finds you before they find a business across the city.",
  },
  {
    mark: "\u{1F50D}",
    title: "Reach customers who are ready",
    body: "People arrive here having already decided what they need. They are not browsing — they are choosing between the businesses on the page.",
  },
  {
    mark: "\u{1F4AC}",
    title: "Enquiries in one place",
    body: "Customers can call or WhatsApp you directly, or send an enquiry that waits in your dashboard until you pick it up.",
  },
  {
    mark: "\u{1F4F7}",
    title: "Photos of the real place",
    body: "Show the shop, the work, the team. A page with photographs is the difference between being considered and being scrolled past.",
  },
  {
    mark: "\u{1F9F0}",
    title: "Your services, in your words",
    body: "Describe what you actually do, answer the questions you are asked every day, and list the things people come to you for.",
  },
  {
    mark: "\u{1F4DE}",
    title: "Contact details that work",
    body: "Phone, WhatsApp, address, map, opening hours and an Open now badge, so nobody turns up to a closed shutter.",
  },
  {
    mark: "✔",
    title: "The Verified badge",
    body: "A badge on your listing wherever it appears, telling a stranger that our team has checked this business is real.",
  },
];

const STEPS: { title: string; body: string }[] = [
  {
    title: "Sign in with your mobile number",
    body: "We send a 6-digit code by SMS. There is no password to invent or lose, and the number you verify is the number that owns the listing.",
  },
  {
    title: "Tell us about your business",
    body: "Its name, what it does, and the locality it serves. This is the short form that creates your business on the directory.",
  },
  {
    title: "Fill in your page",
    body: "Address and map, opening hours, phone and WhatsApp, photos, services and links — as much or as little as you want, and you can come back to it any time.",
  },
  {
    title: "We check it, then it goes live",
    body: "Our team reviews every new listing before it appears, which is what keeps the directory worth searching. You will see its status in your dashboard throughout.",
  },
];

/** The wide teal call-to-action used twice on this page, top and bottom. */
function RegisterBand({ heading, body }: { heading: string; body: string }) {
  return (
    <section className="mt-14 rounded-2xl bg-[linear-gradient(110deg,#00242c_0%,#003a47_60%,#062a34_100%)] px-6 py-10 text-center text-white sm:px-10 sm:py-12">
      <h2 className="text-2xl font-black tracking-tight sm:text-3xl">{heading}</h2>
      <p className="mx-auto mt-3 max-w-2xl text-[15px] text-brand-100">{body}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <ButtonLink tone="inverse" href={REGISTER_HREF}>
          Register Your Business <span aria-hidden="true">&rarr;</span>
        </ButtonLink>
      </div>
      <p className="mt-4 text-sm text-brand-100">
        Takes a few minutes. Listing is free, and stays free.
      </p>
    </section>
  );
}

export default async function ListYourBusinessPage() {
  const plans = await getPublicPlans();

  return (
    <>
      <PageHero
        crumbs={[{ label: "Home", href: "/" }, { label: "List your business" }]}
        title="List your business on Hyderabad Links"
        subtitle="Be found by the people already searching your category, in your part of the city."
        aside={
          <ButtonLink tone="inverse" href={REGISTER_HREF}>
            Register Your Business
          </ButtonLink>
        }
      />

      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 lg:py-14">
        {/* What this is, before what it gets you. */}
        <section aria-labelledby="what-it-is">
          <h2 id="what-it-is" className="text-2xl font-black tracking-tight text-brand-800">
            A directory built around where you are
          </h2>
          <div className="mt-4 grid gap-4 text-[15px] leading-relaxed text-muted sm:text-base">
            <p>
              {BRAND_NAME} is a local business directory for Hyderabad. Every listing belongs to a
              category and a locality, so somebody looking for a plumber in their own neighbourhood
              gets the businesses in that neighbourhood — not a list of the whole city sorted by who
              paid the most.
            </p>
            <p>
              That is the whole idea, and it is why a small business is worth finding here. You do
              not have to outbid anybody. You have to be the one nearby.
            </p>
          </div>
        </section>

        <RegisterBand
          heading="Ready to be found?"
          body="Register with your mobile number and your business can be on the directory today."
        />

        {/* Benefits */}
        <section aria-labelledby="benefits" className="mt-14">
          <h2 id="benefits" className="text-2xl font-black tracking-tight text-brand-800">
            What a listing gives you
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <li
                key={benefit.title}
                className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]"
              >
                <span aria-hidden="true" className="text-2xl">
                  {benefit.mark}
                </span>
                <h3 className="mt-2 text-lg font-black text-ink">{benefit.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{benefit.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-it-works" className="mt-14">
          <h2 id="how-it-works" className="text-2xl font-black tracking-tight text-brand-800">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-4 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]"
              >
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-black text-white"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-black text-ink">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 text-center">
            <ButtonLink tone="cta" href={REGISTER_HREF}>
              Register Your Business <span aria-hidden="true">&rarr;</span>
            </ButtonLink>
          </div>
        </section>

        {/* Plans. Both read from the plans table, so the figures are the ones that are charged. */}
        <section aria-labelledby="plans" className="mt-14">
          <h2 id="plans" className="text-2xl font-black tracking-tight text-brand-800">
            Two ways to be listed
          </h2>
          <p className="mt-2 text-[15px] text-muted">
            Being on the directory is free. The Verified plan adds what helps somebody choose you
            over the shop next door.
          </p>

          {plans.length === 0 ? (
            <div className="mt-6">
              <EmptyState tone="error" mark="&#9888;" title="We could not load our plans">
                <p>
                  Please try again in a moment, or see the{" "}
                  <Link href="/pricing" className="font-bold text-red-900 underline">
                    membership page
                  </Link>
                  .
                </p>
              </EmptyState>
            </div>
          ) : (
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {plans.map((plan) => {
                const paid = plan.pricePaise > 0;
                return (
                  <section
                    key={plan.slug}
                    className={`rounded-2xl border p-6 shadow-[0_8px_28px_#002a3412] sm:p-8 ${
                      paid
                        ? "border-amber-300 bg-gradient-to-b from-amber-50/60 to-white"
                        : "border-line bg-white"
                    }`}
                  >
                    {paid ? (
                      <p className="mb-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black tracking-wider text-amber-900">
                        MOST USEFUL
                      </p>
                    ) : null}

                    <h3 className="text-xl font-black text-brand-800">{plan.name} Listing</h3>
                    <p className="mt-2">
                      <span className="text-4xl font-black text-ink">{rupees(plan.pricePaise)}</span>
                      <span className="ml-1 text-sm font-bold text-muted">
                        {paid ? "a year" : "forever"}
                      </span>
                    </p>

                    <ul className="mt-6 grid gap-2.5 text-[15px]">
                      {planLines(plan).map((line) => (
                        <li key={line.text} className="flex items-start gap-2.5">
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 shrink-0 font-black ${
                              line.included ? "text-green-700" : "text-neutral-300"
                            }`}
                          >
                            {line.included ? "✓" : "—"}
                          </span>
                          <span className={line.included ? "text-ink" : "text-muted"}>{line.text}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-7">
                      <ButtonLink tone={paid ? "cta" : "ghost"} href={REGISTER_HREF}>
                        Register Your Business
                      </ButtonLink>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <p className="mt-6 text-center text-sm text-muted">
            The full comparison is on the{" "}
            <Link href="/pricing" className="font-bold text-brand-700 hover:underline">
              membership page
            </Link>
            . You can start free and upgrade whenever you want.
          </p>
        </section>

        <RegisterBand
          heading="Put your business on the map"
          body="Sign in with your mobile number, tell us about your business, and we will take it from there."
        />
      </main>
    </>
  );
}

/** The handful of lines worth showing on a card here. The full comparison lives on /pricing. */
function planLines(plan: {
  grantsVerifiedBadge: boolean;
  photoLimit: number;
  videoLimit: number;
  linkLimit: number;
}): { text: string; included: boolean }[] {
  return [
    { text: "Found by name, category and area", included: true },
    { text: "Customers call or WhatsApp you directly", included: true },
    { text: "Enquiries in your dashboard", included: true },
    { text: "Opening hours and Open now", included: true },
    { text: "Verified badge on your page", included: plan.grantsVerifiedBadge },
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
  ];
}
