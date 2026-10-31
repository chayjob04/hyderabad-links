import type { Metadata } from "next";
import Link from "next/link";
import { getPageMeta, withPageMeta } from "@/lib/api";
import { BRAND_NAME, DEFAULT_CITY_NAME, SUPPORT_EMAIL } from "@/lib/brand";
import { absoluteUrl } from "@/lib/format";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const applied = withPageMeta(
    {
      title: `About ${BRAND_NAME}`,
      description: `${BRAND_NAME} is a local business directory for ${DEFAULT_CITY_NAME}: find a business near you and contact it directly.`,
    },
    await getPageMeta("static", "about"),
  );

  return { ...applied, alternates: { canonical: absoluteUrl("/about") } };
}

/**
 * What this site is and how it works.
 *
 * Deliberately specific rather than the usual about-page filler. The two things worth a visitor's
 * attention are that contact is direct — there is no booking fee and nothing sits between them and
 * the business — and that a verified badge means a paid plan rather than an inspection, because a
 * badge whose meaning is vague is worse than no badge.
 */
export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <p className="text-[11px] font-black tracking-[0.22em] text-muted">ABOUT</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-brand-800 sm:text-4xl">
        {BRAND_NAME}
      </h1>
      <p className="mt-4 text-[17px] leading-relaxed text-ink">
        A directory of businesses in {DEFAULT_CITY_NAME}, organised by what they do and where they
        are, so you can find the nearest one and contact it yourself.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-black text-brand-800">How it works</h2>
        <div className="mt-4 grid gap-5">
          <div>
            <h3 className="font-black text-ink">You contact the business directly</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">
              Every listing shows a phone number and, where the business has one, a WhatsApp link.
              Nothing sits in between: we take no commission, add no booking fee and do not pass
              your details to anyone you have not written to.
            </p>
          </div>
          <div>
            <h3 className="font-black text-ink">Search knows the city</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">
              Results are ordered by how far a business is from the area you chose, and the search
              forgives a misspelled place name &mdash; typing &ldquo;madapur&rdquo; still finds
              Madhapur.
            </p>
          </div>
          <div>
            <h3 className="font-black text-ink">Listings are reviewed before they appear</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">
              A business owner submits a listing and a moderator reads it before it goes live.
              Anyone can report one that is wrong.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-10 rounded-2xl border border-line bg-brand-50/50 p-6">
        <h2 className="text-xl font-black text-brand-800">What the Verified badge means</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink">
          It means the business is on a paid plan and has confirmed its own details. It is{" "}
          <strong>not</strong> an inspection, a rating, or a recommendation from us &mdash; we have
          not visited the premises or tested the work.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          We would rather say that plainly than let a badge imply something we have not done.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-black text-brand-800">If you run a business here</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Listing is free. The Verified plan adds a badge, photos, videos, links and answers to the
          questions customers ask.{" "}
          <Link href="/pricing" className="font-bold text-brand-700 hover:underline">
            See what it costs
          </Link>
          .
        </p>
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="text-xl font-black text-brand-800">Getting in touch</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Something wrong with a listing, or a question about your own?{" "}
          <Link href="/help" className="font-bold text-brand-700 hover:underline">
            Help &amp; feedback
          </Link>{" "}
          has the ways to reach us, or write to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold text-brand-700 hover:underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </main>
  );
}
