import { BRAND_NAME, SUPPORT_EMAIL } from "@/lib/brand";

/**
 * The shell for Terms of use and Privacy policy.
 *
 * Both are linked from the footer and both are waiting on their real text, which has to be written
 * by the owner — these are commitments the site makes to the people using it, and inventing them
 * would be worse than saying plainly that they are not ready. The page says so, gives a way to ask,
 * and is marked noindex until the text lands.
 */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-10 pb-16 sm:px-8">
      <h1 className="text-3xl font-black tracking-tight text-brand-800">{title}</h1>
      <p className="mt-3 text-muted">{children}</p>

      <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <p className="font-black text-amber-900">This page is being written.</p>
        <p className="mt-2 text-sm text-amber-900">
          {BRAND_NAME} is not live to the public yet, and this text will be published before it is.
          If you need to know something in the meantime, ask us directly:
        </p>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="mt-4 inline-block font-bold text-brand-700 underline-offset-2 hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>
      </div>
    </main>
  );
}
