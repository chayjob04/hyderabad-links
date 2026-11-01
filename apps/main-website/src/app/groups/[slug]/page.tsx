import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingCard } from "@/components/ListingCard";
import { PageHero } from "@/components/PageHero";
import { getHighlights, getPageMeta, withPageMeta } from "@/lib/api";
import { DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";
import type { FeaturedGroup, SearchListing } from "@/lib/types";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

/** The shelf whose slug this is, or undefined. Shared by the metadata and the page itself. */
async function findGroup(slug: string): Promise<FeaturedGroup | undefined> {
  const highlights = await getHighlights(DEFAULT_CITY);
  return highlights.featuredGroups.find((group) => group.slug === slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const group = await findGroup(slug);
  if (!group) return { title: "Not found" };

  return withPageMeta(
    {
      title: group.title,
      description:
        group.subtitle ?? `${group.title} — businesses chosen by our team in ${DEFAULT_CITY_NAME}.`,
    },
    await getPageMeta("page", `group-${slug}`),
  );
}

/**
 * One named shelf on its own page — the original's `HomePageListingGroup` / `hplg`.
 *
 * It reads the same highlights payload the homepage reads, so a shelf cannot say one thing on the
 * homepage and another here, and no new endpoint was needed for it. That also sets the honest
 * limit: the payload carries the shelf, which staff cap when they curate it, so this page shows
 * the shelf rather than claiming to be a full search. The link to `/search` at the bottom is where
 * someone goes when they want everything.
 *
 * A shelf with no live listings is left out of the payload entirely, so an inactive or empty group
 * answers 404 here rather than rendering a heading over nothing.
 */
export default async function HomepageGroupPage({ params }: Props) {
  const { slug } = await params;
  const group = await findGroup(slug);
  if (!group) notFound();

  /* The shelf's cards carry everything ListingCard needs except `distanceMetres`, which only a
     search from a point can know. Null means the card simply draws no distance chip. */
  const listings: SearchListing[] = group.listings.map((listing) => ({
    ...listing,
    distanceMetres: null,
  }));

  return (
    <>
      <PageHero
        crumbs={[{ label: "Home", href: "/" }, { label: group.title }]}
        title={group.title}
        subtitle={group.subtitle ?? `${listings.length} chosen by our team`}
      />

      <main className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8">
        <p className="text-sm text-muted">
          Chosen by our team. Being on this list is not something a business can buy.
        </p>

        <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <ListingCard key={listing.slug} listing={listing} />
          ))}
        </ul>

        <p className="mt-10 text-center text-sm text-muted">
          Looking for something else?{" "}
          <Link href="/search" className="font-bold text-brand-700 hover:underline">
            Search every business
          </Link>
          .
        </p>
      </main>
    </>
  );
}
