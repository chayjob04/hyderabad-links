import type { Metadata } from "next";
import Link from "next/link";
import { BRAND_NAME, SUPPORT_EMAIL } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Help & feedback",
  description: `Get help with your ${BRAND_NAME} listing, or tell us what could be better.`,
};

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-10 pb-16 sm:px-8">
      <h1 className="text-3xl font-black tracking-tight text-brand-800">Help &amp; feedback</h1>
      <p className="mt-2 text-muted">
        Something wrong with a listing, or an idea for the site? Tell us and a person will read it.
      </p>

      <section className="mt-8 rounded-2xl border border-line bg-white p-6 shadow-[0_8px_22px_#002a340b]">
        <h2 className="text-lg font-black text-brand-800">Email us</h2>
        <p className="mt-1 text-sm text-muted">
          The quickest way to reach us. Include the name of the business if your question is about a
          particular listing.
        </p>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="mt-4 inline-block rounded-full bg-brand-700 px-6 py-3 text-sm font-extrabold text-white hover:bg-brand-800"
        >
          {SUPPORT_EMAIL}
        </a>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card title="Your business is not showing" href="/account/listings">
          A listing goes live only after we have reviewed it, and it goes back for review whenever
          you edit it. Check its status on your listings page.
        </Card>
        <Card title="Add your business" href="/account/listings">
          Free to list. Sign in with your mobile number and fill in the details.
        </Card>
        <Card title="Report a listing" href="/search">
          Open the business and use the report link at the bottom of its page.
        </Card>
        <Card title="Plans and payment" href="/account/subscription">
          Free listings stay free. The Verified plan is &#8377;399 a year.
        </Card>
      </section>
    </main>
  );
}

function Card({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b] hover:border-brand-700"
    >
      <h3 className="font-black text-brand-800">{title}</h3>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </Link>
  );
}
