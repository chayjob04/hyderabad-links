import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { ListingCard } from "@/components/ListingCard";
import { Pagination } from "@/components/Pagination";
import { SearchBox } from "@/components/SearchBox";
import { getCategories, getLocalities, searchListings } from "@/lib/api";
import { DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";
import { findSubCategory, toSearchCategories } from "@/lib/categories";
import { absoluteUrl } from "@/lib/format";
import type { SearchCriteria, SearchResults } from "@/lib/types";

const PAGE_SIZE = 20;

type Props = {
  params: Promise<{ category: string; subcategory: string }>;
  searchParams: Promise<{ page?: string }>;
};

async function loadPage(params: Props["params"]) {
  const { category, subcategory } = await params;
  const [tree, localities] = await Promise.all([getCategories(), getLocalities(DEFAULT_CITY)]);

  // The parent is checked, not just the subcategory: /shopping/cafes must not answer with the
  // same page as /food/cafes. See findSubCategory.
  const found = findSubCategory(tree, category, subcategory);
  if (!found) return null;

  return { tree, localities: localities ?? [], parent: found.parent, sub: found.sub };
}

function criteriaFor(categorySlug: string, page: number): SearchCriteria {
  return { city: DEFAULT_CITY, category: categorySlug, page, pageSize: PAGE_SIZE };
}

function pageNumber(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = await loadPage(params);
  if (!page) return { title: "Not found", robots: { index: false } };

  const pageNo = pageNumber((await searchParams).page);
  const title = `${page.sub.name} in ${DEFAULT_CITY_NAME}`;

  let isEmpty = true;
  try {
    isEmpty = (await searchListings(criteriaFor(page.sub.slug, pageNo))).total === 0;
  } catch {
    // A failed lookup must not break metadata; fall back to not indexing.
  }

  return {
    title: pageNo > 1 ? `${title} - page ${pageNo}` : title,
    description: `Find ${page.sub.name.toLowerCase()} across ${DEFAULT_CITY_NAME}. Call or WhatsApp local businesses directly.`,
    alternates: { canonical: absoluteUrl(`/${page.parent.slug}/${page.sub.slug}`) },
    robots: isEmpty || pageNo > 1 ? { index: false, follow: true } : undefined,
  };
}

export default async function SubCategoryPage({ params, searchParams }: Props) {
  const page = await loadPage(params);
  if (!page) {
    /* The same courtesy the top-level page extends: /ameerpet/cafes is what someone types when
       they have dropped the /areas prefix, and that page exists. Only reached once the category
       pair has failed to resolve, so a real category is never shadowed by an area of the same
       name. */
    const { category, subcategory } = await params;
    const localities = await getLocalities(DEFAULT_CITY);
    if (localities?.some((l) => l.slug === category)) {
      permanentRedirect(`/areas/${category}/${subcategory}`);
    }
    notFound();
  }

  const pageNo = pageNumber((await searchParams).page);

  let results: SearchResults | null = null;
  try {
    results = await searchListings(criteriaFor(page.sub.slug, pageNo));
  } catch {
    results = null;
  }

  const basePath = `/${page.parent.slug}/${page.sub.slug}`;

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8">
      <SearchBox categories={toSearchCategories(page.tree)} initialQuery={page.sub.name} />

      <nav aria-label="Breadcrumb" className="mt-8 text-sm text-neutral-500">
        <Link href={`/${page.parent.slug}`} className="hover:underline">
          {page.parent.name}
        </Link>
        <span aria-hidden="true"> &rsaquo; </span>
        <span className="text-neutral-800">{page.sub.name}</span>
      </nav>

      <h1 className="mt-1 text-2xl font-bold">
        {page.sub.name} in {DEFAULT_CITY_NAME}
      </h1>

      {/* Narrowing to an area is the usual next step on a city-wide list. */}
      {page.localities.length > 0 ? (
        <nav aria-label="Browse by area" className="mt-4 flex flex-wrap gap-2">
          {page.localities.slice(0, 24).map((area) => (
            <Link
              key={area.slug}
              href={`/areas/${area.slug}/${page.sub.slug}`}
              className="rounded-full border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
            >
              {area.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {results === null ? (
        <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="font-medium text-red-900">We could not load these listings just now.</p>
          <p className="mt-1 text-sm text-red-800">Please refresh the page in a moment.</p>
        </div>
      ) : results.total === 0 ? (
        <p className="mt-6 text-neutral-600">Nothing listed under {page.sub.name} yet.</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-neutral-500">
            {results.total} {results.total === 1 ? "business" : "businesses"}
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
              name: `${page.sub.name} in ${DEFAULT_CITY_NAME}`,
              itemListElement: results.items.map((listing, index) => ({
                "@type": "ListItem",
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
