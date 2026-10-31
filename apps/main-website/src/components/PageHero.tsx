import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { label: string; href?: string };

type Props = {
  crumbs: Crumb[];
  title: ReactNode;
  /** One line under the heading: a result count, an area, whatever the page is about. */
  subtitle?: ReactNode;
  /** Shown on the right at desktop width — a badge, a button, a rating. */
  aside?: ReactNode;
};

/**
 * The teal banner at the top of every inner page, with the breadcrumb and the heading inside it.
 *
 * This is the original Hyderabad Links' signature: `listing_bredcum`, a deep band carrying the
 * trail and the page title, with the content below sitting against white. Every inner page had
 * one, which is what made the site feel like one site rather than a set of templates — the version
 * here put a grey breadcrumb on white and looked like a different product on every route.
 *
 * The original drew a decorative wave under the band with a pseudo-element and a background image.
 * That is reproduced as a CSS gradient edge instead: same effect at the top of the content, no
 * image to load and nothing to go missing.
 *
 * The last crumb is rendered as text, never a link — a link to the page you are on is a small lie,
 * and `aria-current` tells a screen reader the same thing.
 */
export function PageHero({ crumbs, title, subtitle, aside }: Props) {
  return (
    <section className="relative isolate overflow-hidden bg-[linear-gradient(110deg,#00242c_0%,#003a47_60%,#062a34_100%)] text-white">
      {/* The same faint grid the homepage hero uses, so the two read as one family. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-10 [background-image:linear-gradient(90deg,transparent_0_48px,#2bb3c2_49px,transparent_50px),linear-gradient(0deg,transparent_0_48px,#2bb3c2_49px,transparent_50px)] [background-size:50px_50px] [mask-image:linear-gradient(to_bottom,#000,transparent)]"
      />

      <div className="mx-auto max-w-[1500px] px-5 py-10 sm:px-8 sm:py-12 lg:px-12 lg:py-14 xl:px-16">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-brand-100">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                  {crumb.href && !last ? (
                    <Link href={crumb.href} className="hover:text-white hover:underline">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className={last ? "text-white" : undefined}>
                      {crumb.label}
                    </span>
                  )}
                  {last ? null : (
                    <span aria-hidden="true" className="text-brand-300">
                      /
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-black tracking-tight sm:text-3xl lg:text-4xl">{title}</h1>
            {subtitle ? <p className="mt-2 text-[15px] text-brand-100">{subtitle}</p> : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
      </div>
    </section>
  );
}
