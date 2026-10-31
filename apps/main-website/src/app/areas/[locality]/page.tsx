import { PageHero } from "@/components/PageHero";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { ListingCard } from "@/components/ListingCard";
import { Pagination } from "@/components/Pagination";
import { SearchBox } from "@/components/SearchBox";
import { getCategories, getLocalities, getPageMeta, searchListings, withPageMeta } from "@/lib/api";
import { DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";
import { toSearchCategories } from "@/lib/categories";
import { absoluteUrl } from "@/lib/format";
import type { SearchCriteria, SearchResults } from "@/lib/types";

/** Businesses in the area come first, and those just outside it still appear. */
const RADIUS_KM = 8;
const PAGE_SIZE = 20;

type Props = {
  params: Promise<{ locality: string }>;
  searchParams: Promise<{ page?: string }>;
};

async function loadPage(params: Props["params"]) {
  const { locality } = await params;
  const [tree, localities] = await Promise.all([getCategories(), getLocalities(DEFAULT_CITY)]);
  const area = localities?.find((l) => l.slug === locality);
  if (!localities || !area) return null;
  return { tree, area };
}

/** The same criteria in metadata and in the body, so Next.js reuses one API request. */
function criteriaFor(area: { latitude: number; longitude: number }, page: number): SearchCriteria {
  return {
    city: DEFAULT_CITY,
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
  const title = `Businesses in ${page.area.name}, ${DEFAULT_CITY_NAME}`;

  // An area with nothing in it yet is a thin page; keep it out of the index until it has content.
  let isEmpty = true;
  try {
    isEmpty = (await searchListings(criteriaFor(page.area, pageNo))).total === 0;
  } catch {
    // A failed lookup must not break metadata; fall back to not indexing.
  }

  const applied = withPageMeta(
    {
      title: pageNo > 1 ? `${title} - page ${pageNo}` : title,
      description: `Local businesses in and near ${page.area.name}, ${DEFAULT_CITY_NAME}. Call or WhatsApp them directly.`,
    },
    await getPageMeta("locality", page.area.slug),
  );

  return {
    ...applied,
    alternates: { canonical: absoluteUrl(`/areas/${page.area.slug}`) },
    // An override saying noindex wins; otherwise a thin or paged view stays out of the index.
    robots: applied.robots ?? (isEmpty || pageNo > 1 ? { index: false, follow: true } : undefined),
  };
}

export default async function AreaPage({ params, searchParams }: Props) {
  const page = await loadPage(params);
  if (!page) notFound();

  const pageNo = pageNumber((await searchParams).page);

  let results: SearchResults | null = null;
  try {
    results = await searchListings(criteriaFor(page.area, pageNo));
  } catch {
    results = null;
  }

  const basePath = `/areas/${page.area.slug}`;

  return (
    <>
      <PageHero
        crumbs={[{ label: "Home", href: "/" }, { label: page.area.name }]}
        title={
          <>
            Businesses in <span className="text-[#42d0dc]">{page.area.name}</span>
          </>
        }
        subtitle={DEFAULT_CITY_NAME}
      />

      <main className="mx-auto max-w-5xl px-5 pt-8 pb-16 sm:px-8">
        <SearchBox categories={toSearchCategories(page.tree)} />

      {/* Narrowing by category from here is the common next step, so the links are on the page
          rather than only in the search box. */}
      <nav aria-label="Browse by category" className="mt-4 flex flex-wrap gap-2">
        {page.tree.flatMap((parent) =>
          parent.children.map((sub) => (
            <Link
              key={`${parent.slug}/${sub.slug}`}
              href={`/areas/${page.area.slug}/${sub.slug}`}
              className="rounded-full border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
            >
              {sub.name}
            </Link>
          )),
        )}
      </nav>

      {results === null ? (
        <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="font-medium text-red-900">We could not load these listings just now.</p>
          <p className="mt-1 text-sm text-red-800">Please refresh the page in a moment.</p>
        </div>
      ) : results.total === 0 ? (
        <p className="mt-6 text-neutral-600">No listings here yet. Try a nearby area.</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-neutral-500">
            {results.total} {results.total === 1 ? "business" : "businesses"} within {RADIUS_KM} km. Closest first,
            including nearby areas.
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
              name: `Businesses in ${page.area.name}, ${DEFAULT_CITY_NAME}`,
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
    </>
  );
}
