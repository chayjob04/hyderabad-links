import { JsonLd } from "@/components/JsonLd";
import { SearchBox } from "@/components/SearchBox";
import { BusinessCard } from "@/components/ui/BusinessCard";
import { FeaturedBusiness } from "@/components/ui/FeaturedBusiness";
import { ButtonLink } from "@/components/ui/Button";
import { CategoryCard } from "@/components/ui/CategoryCard";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getCategories, getHighlights } from "@/lib/api";
import { BRAND_NAME, DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";
import { toSearchCategories } from "@/lib/categories";
import { absoluteUrl } from "@/lib/format";

// Fetches live data, so it must render per request (never at build time).
export const dynamic = "force-dynamic";

/** How many of each thing the homepage shows. Enough to fill the grids, not enough to be a listing page. */
const CATEGORY_CARDS = 8;
const ITEMS_PER_CARD = 4;

/*
 * The shared measurements, in one place, because the sections used to set their own: one grid was
 * capped at 1600px and the next at 1500px, so their left edges did not line up down the page. Every
 * section below uses SECTION for its padding and SHELL for its width, which is what makes the page
 * read as one column rather than several.
 */
const SECTION = "px-5 py-16 sm:px-8 sm:py-20 lg:px-12 lg:py-28 xl:px-16";
const SHELL = "mx-auto w-full max-w-[1480px]";

/** The card grid. Two up on a phone, four on a desktop, with room to breathe at both ends. */
const CARD_GRID = "grid grid-cols-2 gap-x-5 gap-y-10 sm:gap-x-8 sm:gap-y-12 lg:grid-cols-4 lg:gap-x-10 lg:gap-y-14";

export default async function HomePage() {
  const tree = await getCategories();

  /*
   * Both shelves come from the database, and they are deliberately different kinds of thing.
   * Featured is chosen by hand on the super-admin surface, so it is a recommendation someone made
   * and signed their name to. Trending is "most enquiries, favourites and approved reviews in the
   * last 30 days" — measured events, not a score this site made up, and nobody can put a business
   * on it. Either can legitimately come back empty (nothing featured yet, no activity yet), and a
   * shelf with nothing in it is skipped rather than padded out with whatever else was to hand.
   */
  const highlights = await getHighlights(DEFAULT_CITY);

  const quickLinks = tree.slice(0, 7);

  return (
    <main>
      {/* Who this site is and how to search it, in the form crawlers read. The listing pages have
          carried LocalBusiness from the start; the homepage carried nothing, so nothing told a
          search engine what the site as a whole is. SearchAction is what a sitelinks search box is
          built from. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": absoluteUrl("/#organization"),
              name: BRAND_NAME,
              url: absoluteUrl("/"),
              logo: absoluteUrl("/hyderabad-links-logo.png"),
              areaServed: { "@type": "City", name: DEFAULT_CITY_NAME },
            },
            {
              "@type": "WebSite",
              "@id": absoluteUrl("/#website"),
              name: BRAND_NAME,
              url: absoluteUrl("/"),
              publisher: { "@id": absoluteUrl("/#organization") },
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: absoluteUrl("/search?q={search_term_string}"),
                },
                "query-input": "required name=search_term_string",
              },
            },
          ],
        }}
      />
      <section className="flex h-8 items-center gap-3 overflow-hidden bg-[#050505] px-5 text-[11px] whitespace-nowrap text-white sm:justify-center sm:text-[13px]">
        <span>Everything about a business, and all its digital profiles, in one place</span>
        <b className="text-brand-400">&bull;</b>
        <span>Chat directly with businesses on WhatsApp</span>
        <b className="text-brand-400">&bull;</b>
        <span>Find businesses that can help you in your language</span>
      </section>

      {/* Hero. The illustration is drawn in CSS - gradients and a faint grid - so it costs no image. */}
      {/* The hero shares the page gutter so its text starts on the same line as every section
          below it; without that it sat 44px further left than the rest of the page at desktop width. */}
      <section className="relative isolate overflow-hidden bg-[linear-gradient(110deg,#00242c_0%,#003a47_55%,#062a34_100%)] px-5 py-16 text-white sm:px-8 sm:py-20 lg:px-12 lg:py-24 xl:px-16">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_15%_35%,#0d7b8c55,transparent_30%),radial-gradient(ellipse_at_80%_30%,#12647755,transparent_33%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 opacity-15 [background-image:linear-gradient(90deg,transparent_0_48px,#2bb3c2_49px,transparent_50px),linear-gradient(0deg,transparent_0_48px,#2bb3c2_49px,transparent_50px)] [background-size:50px_50px] [mask-image:linear-gradient(to_bottom,transparent,#000_30%,#000_85%,transparent)]"
        />

        <div className="mx-auto w-full max-w-[1050px] text-center">
          <p className="text-[11px] font-black tracking-[0.22em] text-brand-400">YOUR CITY. YOUR BUSINESSES.</p>
          <h1 className="mt-3 text-4xl leading-[1.06] font-black tracking-tight sm:text-5xl lg:text-6xl">
            Discover Hyderabad.
            <br />
            <span className="text-[#42d0dc]">Connect locally.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-brand-100 sm:text-[17px]">
            Find local businesses, services and professionals across Hyderabad &mdash; all in one place.
          </p>

          <div className="mx-auto mt-7 max-w-3xl text-left">
            <SearchBox categories={toSearchCategories(tree)} />
          </div>

          {quickLinks.length > 0 ? (
            <nav aria-label="Popular categories" className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-4">
              {quickLinks.map((parent) => (
                <a
                  key={parent.slug}
                  href={`/${parent.slug}`}
                  className="flex min-w-[64px] flex-col items-center gap-2 text-[11px] font-bold text-white sm:text-xs"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-10 w-10 place-items-center rounded-full border border-brand-300/70 bg-white/5 text-lg font-black text-[#7de3e9] transition hover:-translate-y-0.5 hover:bg-brand-500 hover:text-white sm:h-11 sm:w-11"
                  >
                    <CategoryIcon slug={parent.slug} name={parent.name} className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />
                  </span>
                  {parent.name}
                </a>
              ))}
            </nav>
          ) : null}
        </div>
      </section>

      {/*
        Featured, directly under the hero: the businesses the team has chosen are the first thing
        the page says after "what are you looking for". It is a glance, not a grid to study — a
        circle and a name each — so it introduces the directory without pushing everything else
        below the fold the way eight full cards did.

        No kicker and no description. The heading is the whole claim.
      */}
      {highlights.featured.length > 0 ? (
        <section className={`border-b border-brand-100 bg-brand-50/60 ${SECTION}`}>
          <div className={SHELL}>
            <h2 className="mb-8 border-b border-dashed border-brand-200 pb-4 text-center text-sm font-black tracking-[0.22em] text-brand-700 sm:text-base">
              FEATURED BUSINESSES
            </h2>
            {/* Four across on a phone, eight on a wide screen: one row either way. */}
            <div className="grid grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-8 lg:gap-x-8">
              {highlights.featured.map((listing) => (
                <FeaturedBusiness
                  key={listing.url}
                  name={listing.name}
                  href={listing.url}
                  imageUrl={listing.logoUrl ?? listing.photoUrl}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/*
        Trending. Replaces the old "Businesses on Hyderabad Links" shelf, which existed only because
        there was nothing real to rank by; there is now. The subtitle states the measure, so the
        ordering is something a visitor can judge rather than take on trust.
      */}
      {highlights.trending.length > 0 ? (
        <section className={`bg-night text-white ${SECTION}`}>
          <div className={SHELL}>
            <SectionHeading
              onDark
              mark="&#9832;"
              kicker="BUSY RIGHT NOW"
              title={
                <>
                  Trending <span className="text-brand-200">in Hyderabad</span>
                </>
              }
            />
            <p className="mx-auto -mt-2 mb-10 max-w-2xl text-center text-[15px] leading-relaxed text-brand-100 lg:mb-14">
              The businesses people have contacted, saved and reviewed most in the last{" "}
              {highlights.trendingWindowDays} days.
            </p>
            <div className={CARD_GRID}>
              {highlights.trending.map((listing) => (
                <BusinessCard
                  key={listing.url}
                  tone="dark"
                  name={listing.name}
                  categoryName={listing.categoryName}
                  href={listing.url}
                  imageUrl={listing.logoUrl ?? listing.photoUrl}
                  verified={listing.verified}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/*
        Browsing by category, below both shelves. The shelves answer "show me something"; this
        answers "I know roughly what I want", which is the slower of the two intents and so belongs
        after them.

        The category tree degrades to an empty list when the API cannot be reached (see
        getCategories), so this section is skipped rather than left as a heading over an empty grid.
      */}
      {tree.length > 0 ? (
        <section id="most-searched" className={SECTION}>
          <div className={SHELL}>
            <SectionHeading
              mark="&#8981;"
              kicker="FIND WHAT YOU NEED"
              title={
                <>
                  Most Searched Businesses &amp; Services <span className="text-[#294d56]">in Hyderabad</span>
                </>
              }
            />
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-7 lg:grid-cols-4 lg:gap-10">
              {tree.slice(0, CATEGORY_CARDS).map((parent) => (
                <CategoryCard
                  key={parent.slug}
                  title={parent.name}
                  parentSlug={parent.slug}
                  items={parent.children.slice(0, ITEMS_PER_CARD)}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="border-t border-brand-200 bg-brand-50 px-5 py-14 sm:px-8 sm:py-16 lg:px-12 xl:px-16">
        <div className={`flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center ${SHELL}`}>
          <div className="max-w-xl">
            <p className="text-[11px] font-black tracking-[0.22em] text-muted">ARE YOU A BUSINESS OWNER?</p>
            <h2 className="mt-3 text-2xl leading-tight font-black text-brand-800 sm:text-3xl">
              Make your business easier to discover.
            </h2>
            <p className="mt-3 leading-relaxed text-muted">
              Bring your business details and digital profiles together on Hyderabad Links.
            </p>
          </div>
          <ButtonLink tone="cta" href="/login" className="shrink-0">
            List your business <span aria-hidden="true">&rarr;</span>
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
