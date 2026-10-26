import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { ListingCard } from "@/components/ListingCard";
import { Pagination } from "@/components/Pagination";
import { SearchBox } from "@/components/SearchBox";
import { getCategories, getLocalities, searchListings } from "@/lib/api";
import { DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";
import { findCategory, toSearchCategories } from "@/lib/categories";
import { absoluteUrl } from "@/lib/format";
import type { SearchCriteria, SearchResults } from "@/lib/types";

/** Businesses in the area come first, and those just outside it still appear. */
const RADIUS_KM = 8;
const PAGE_SIZE = 20;

type Props = {
  params: Promise<{ locality: string; category: string }>;
  searchParams: Promise<{ page?: string }>;
};

async function loadPage(params: Props["params"]) {
  const { locality, category } = await params;
  // The city is no longer a path segment — the directory covers one — so it comes from config.
  const city = DEFAULT_CITY;
  const [tree, localities] = await Promise.all([getCategories(), getLocalities(city)]);
  const area = localities?.find((l) => l.slug === locality);
  const found = findCategory(tree, category);
  if (!localities || !area || !found) return null;
  return { city, tree, localities, area, found };
}

/** The same criteria in metadata and in the page body, so Next.js reuses one API request. */
function criteriaFor(area: { latitude: number; longitude: number }, categorySlug: string, page: number): SearchCriteria {
  return {
    city: DEFAULT_CITY,
    category: categorySlug,
    lat: area.latitude,
    lng: area.longitude,
    radiusKm: RADIUS_KM,
    sort: "distance",
    page,
    pageSize: PAGE_SIZE,
  };
}

function pageNumber(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = await loadPage(params);
  if (!page) return { title: "Not found", robots: { index: false } };

  const pageNo = pageNumber((await searchParams).page);
  const title = `${page.found.name} in ${page.area.name}, ${DEFAULT_CITY_NAME}`;
  const canonical = absoluteUrl(`/areas/${page.area.slug}/${page.found.slug}`);

  // An area with nothing in it yet is a thin page; keep it out of the index until it has content.
  let isEmpty = true;
  try {
    isEmpty = (await searchListings(criteriaFor(page.area, page.found.slug, pageNo))).total === 0;
  } catch {
    // A failed lookup must not break metadata; fall back to not indexing.
  }

  return {
    title: pageNo > 1 ? `${title} - page ${pageNo}` : title,
    description: `Find ${page.found.name.toLowerCase()} in and near ${page.area.name}, ${DEFAULT_CITY_NAME}. Call or WhatsApp local businesses directly.`,
    alternates: { canonical },
    robots: isEmpty || pageNo > 1 ? { index: false, follow: true } : undefined,
  };
}

export default async function CategoryInLocalityPage({ params, searchParams }: Props) {
  const page = await loadPage(params);
  if (!page) notFound();

  const pageNo = pageNumber((await searchParams).page);

  let results: SearchResults | null = null;
  try {
    results = await searchListings(criteriaFor(page.area, page.found.slug, pageNo));
  } catch {
    results = null;
  }

  const basePath = `/areas/${page.area.slug}/${page.found.slug}`;

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 pb-16">
      <SearchBox categories={toSearchCategories(page.tree)} initialQuery={page.found.name} />

      <h1 className="mt-8 text-2xl font-bold">
        {page.found.name} in {page.area.name}, {DEFAULT_CITY_NAME}
      </h1>

      {results === null ? (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="font-medium text-red-900">We could not load these listings just now.</p>
          <p className="mt-1 text-sm text-red-800">Please refresh the page in a moment.</p>
        </div>
      ) : results.total === 0 ? (
        <p className="mt-4 text-neutral-600">No listings here yet. Try a nearby area or another service.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-neutral-500">
            {results.total} {results.total === 1 ? "business" : "businesses"} within {RADIUS_KM} km. Closest first, including
            nearby areas.
          </p>

          <ul className="mt-4 grid gap-3">
            {results.items.map((listing) => (
              <ListingCard key={listing.url} listing={listing} />
            ))}
          </ul>

          <Pagination page={results.page} totalPages={results.totalPages} params={{}} basePath={basePath} />

          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "ItemList",
              name: `${page.found.name} in ${page.area.name}, ${DEFAULT_CITY_NAME}`,
              itemListElement: results.items.map((listing, index) => ({
                "@type": "ListItem",
                // Positions continue across pages so the list stays coherent for crawlers.
                position: (results.page - 1) * results.pageSize + index + 1,
                url: absoluteUrl(listing.url),
                name: listing.name,
              })),
            }}
          />
        </>
      )}
    </main>
  );
}
