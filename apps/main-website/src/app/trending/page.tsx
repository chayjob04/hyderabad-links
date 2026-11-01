import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { ListingCard } from "@/components/ListingCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { getHighlights, getPageMeta, withPageMeta } from "@/lib/api";
import { DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  return withPageMeta(
    {
      title: "Trending businesses",
      description: `The businesses people are contacting most across ${DEFAULT_CITY_NAME} right now.`,
    },
    await getPageMeta("page", "trending"),
  );
}

/**
 * The full trending shelf on its own page — the original's `TrendingListing`.
 *
 * The homepage shows the first few and stops. This is the same list without the cut, and it is
 * worth a page of its own because it is the one ranking on the site nobody can buy: it is counted
 * from real enquiries, favourites and approved reviews, not from who paid.
 *
 * `distanceMetres` is added as null so these can use the same card as search results — a shelf is
 * not a proximity search, and the card omits the distance when it has none.
 */
export default async function TrendingPage() {
  const highlights = await getHighlights(DEFAULT_CITY);
  /* `verified` becomes `isVerified`: the highlights payload and a search result spell the same
     flag differently, and ListingCard reads the search spelling. Without this the badge would be
     silently absent on every card here. */
  const items = highlights.trending.map(({ verified, ...listing }) => ({
    ...listing,
    distanceMetres: null,
    isVerified: verified,
  }));

  return (
    <>
      <PageHero
        crumbs={[{ label: "Home", href: "/" }, { label: "Trending" }]}
        title="Trending businesses"
        subtitle={
          items.length > 0
            ? `Most contacted in the last ${highlights.trendingWindowDays} days`
            : undefined
        }
      />

      <main className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8">
        {items.length === 0 ? (
          <EmptyState mark="&#9889;" title="Nothing trending yet">
            <p>
              This list is counted from real enquiries, favourites and reviews. It fills up as
              people start using the directory.
            </p>
          </EmptyState>
        ) : (
          <>
            <p className="text-sm text-muted">
              Counted from enquiries, favourites and approved reviews over the last{" "}
              {highlights.trendingWindowDays} days. Nobody can pay to appear here.
            </p>
            <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((listing) => (
                <ListingCard key={listing.slug} listing={listing} />
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}
