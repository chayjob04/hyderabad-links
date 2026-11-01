import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { ListingCard } from "@/components/ListingCard";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPageMeta, searchListings, withPageMeta } from "@/lib/api";
import { DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  return withPageMeta(
    {
      title: "Verified businesses",
      description: `Businesses in ${DEFAULT_CITY_NAME} that have paid to be verified and had their details checked.`,
    },
    await getPageMeta("page", "verified"),
  );
}

type Props = { searchParams: Promise<{ page?: string; category?: string }> };

/**
 * Every Verified business — the original's `VerifiedListingGroup`, with its by-category variant
 * folded in as a `?category=` filter rather than a second route.
 *
 * Verified is read live from `listing_entitlements`, so a plan that lapsed a minute ago is already
 * gone from this page without anything having run.
 */
export default async function VerifiedPage({ searchParams }: Props) {
  const { page: rawPage, category } = await searchParams;
  const page = Math.max(Number(rawPage ?? "1") || 1, 1);

  const results = await searchListings({
    city: DEFAULT_CITY,
    category: category || undefined,
    verified: true,
    sort: "name",
    page,
  });

  return (
    <>
      <PageHero
        crumbs={[{ label: "Home", href: "/" }, { label: "Verified" }]}
        title="Verified businesses"
        subtitle={
          results.total > 0
            ? `${results.total} verified ${results.total === 1 ? "business" : "businesses"}`
            : undefined
        }
      />

      <main className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8">
        {results.items.length === 0 ? (
          <EmptyState mark="&#10003;" title="No verified businesses here yet">
            <p>
              A Verified listing has been paid for and its details checked. None matches this
              filter yet.
            </p>
          </EmptyState>
        ) : (
          <>
            <p className="text-sm text-muted">
              A Verified business holds a paid plan and has had its details checked by our team.
            </p>
            <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {results.items.map((listing) => (
                <ListingCard key={listing.slug} listing={listing} />
              ))}
            </ul>
            <Pagination
              page={results.page}
              totalPages={results.totalPages}
              params={{ category }}
              basePath="/verified"
            />
          </>
        )}
      </main>
    </>
  );
}
