import type { Metadata } from "next";
import Link from "next/link";
import { ListingCard } from "@/components/ListingCard";
import { Pagination } from "@/components/Pagination";
import { SearchFilters } from "@/components/SearchFilters";
import { ActiveFilters, type ActiveFilter } from "@/components/ui/ActiveFilters";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiResponseError, getCategories, getLocalities, searchListings } from "@/lib/api";
import { DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";
import { findCategory } from "@/lib/categories";
import type { SearchCriteria, SearchResults } from "@/lib/types";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true }, // filtered result pages are not for search engines
};

type RawParams = {
  q?: string;
  category?: string;
  locality?: string;
  sort?: string;
  lat?: string;
  lng?: string;
  radiusKm?: string;
  page?: string;
};

type Props = { searchParams: Promise<RawParams> };

/** Only values the API accepts reach it; anything else is dropped so a stray URL cannot 400 the page. */
function toCriteria(raw: RawParams): SearchCriteria {
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const hasCoordinates = raw.lat !== undefined && raw.lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng);
  const radiusKm = Number(raw.radiusKm);
  const page = Number(raw.page);

  return {
    q: raw.q?.trim() || undefined,
    city: DEFAULT_CITY,
    category: raw.category || undefined,
    locality: raw.locality || undefined,
    lat: hasCoordinates ? lat : undefined,
    lng: hasCoordinates ? lng : undefined,
    radiusKm: hasCoordinates && Number.isFinite(radiusKm) ? radiusKm : undefined,
    sort:
      raw.sort === "distance" && hasCoordinates ? "distance"
      : raw.sort === "name" ? "name"
      : raw.sort === "relevance" ? "relevance"
      : undefined,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : undefined,
  };
}

function headingFor(criteria: SearchCriteria, categoryName: string | null, localityName: string | null): string {
  const what = criteria.q ? `"${criteria.q}"` : categoryName ?? "Businesses";
  const where = localityName ?? (criteria.lat !== undefined ? "near you" : DEFAULT_CITY_NAME);
  return `${what} in ${where}`.replace(" in near you", " near you");
}

/** The same search with one parameter dropped. Used by the "remove this filter" chips. */
function searchWithout(raw: RawParams, ...drop: (keyof RawParams)[]): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === "") continue;
    if (drop.includes(key as keyof RawParams)) continue;
    if (key === "page") continue; // removing a filter starts again at the first page
    query.set(key, value);
  }
  const text = query.toString();
  return text ? `/search?${text}` : "/search";
}

export default async function SearchPage({ searchParams }: Props) {
  const raw = await searchParams;
  const criteria = toCriteria(raw);

  const [tree, localities] = await Promise.all([getCategories(), getLocalities(DEFAULT_CITY)]);
  const areas = localities ?? [];

  let results: SearchResults | null = null;
  /*
   * Two different failures, because they are two different things to tell a visitor. "serverError"
   * is the API answering with a 5xx -- something is wrong at our end and retrying in a moment will
   * not help. "unreachable" is the request never completing. Collapsing both into one message is
   * how a backend outage spent its time telling people the directory was temporarily unreachable
   * while the API was answering every request promptly, with a 500.
   */
  let failure: "serverError" | "unreachable" | null = null;
  try {
    results = await searchListings(criteria);
  } catch (error) {
    failure = error instanceof ApiResponseError && error.status >= 500 ? "serverError" : "unreachable";
    // Server-side: this is the only place the real status is recorded, so log it before it is lost.
    console.error("Search failed", error);
  }

  const categoryName = criteria.category ? findCategory(tree, criteria.category)?.name ?? null : null;
  const localityName = criteria.locality ? areas.find((a) => a.slug === criteria.locality)?.name ?? null : null;

  // What is narrowing the results right now, each with a way to drop just that one.
  const filters: ActiveFilter[] = [];

  /* The keyword chip is dropped when it only repeats the category's own name. Picking a category
     from the search box fills the text box with that name and sets the category, which showed the
     same words twice side by side, each with its own remove button. */
  const keywordRepeatsCategory =
    categoryName !== null && criteria.q?.trim().toLowerCase() === categoryName.toLowerCase();
  if (criteria.q && !keywordRepeatsCategory) {
    filters.push({ kind: "Keyword", label: criteria.q, removeHref: searchWithout(raw, "q") });
  }
  if (criteria.category) {
    filters.push({
      kind: "Category",
      label: categoryName ?? criteria.category,
      removeHref: searchWithout(raw, "category"),
    });
  }
  if (criteria.locality) {
    filters.push({
      kind: "Area",
      label: localityName ?? criteria.locality,
      removeHref: searchWithout(raw, "locality"),
    });
  }
  if (criteria.lat !== undefined) {
    filters.push({
      kind: "Area",
      label: "Near my location",
      // Sorting by distance cannot outlive the coordinates it sorts by.
      removeHref: searchWithout(raw, "lat", "lng", "radiusKm", "sort"),
    });
  }
  if (criteria.sort === "name") {
    filters.push({ kind: "Sorted by", label: "Name (A to Z)", removeHref: searchWithout(raw, "sort") });
  }

  return (
    <main className="mx-auto max-w-[1500px] px-5 pt-10 pb-20 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-black tracking-[0.22em] text-brand-500">HYDERABAD, CONNECTED</p>
        <h1 className="mt-2 text-3xl leading-tight font-black tracking-tight text-brand-700 sm:text-4xl lg:text-5xl">
          {headingFor(criteria, categoryName, localityName)}
        </h1>
        <p className="mt-3 text-muted">Only businesses approved by our team appear in these results.</p>
      </div>

      <div className="mx-auto mt-8 max-w-4xl">
        <SearchFilters criteria={criteria} categories={tree} localityName={localityName} />
      </div>

      {filters.length > 0 ? (
        <div className="mx-auto mt-5 max-w-4xl">
          <ActiveFilters filters={filters} clearAllHref="/search" />
        </div>
      ) : null}

      {failure ? (
        <div className="mt-10">
          <EmptyState tone="error" mark="&#9888;" title="We could not load results just now">
            {failure === "serverError" ? (
              <p>
                Something went wrong at our end, and we are looking into it. Browsing by category or
                area should still work.
              </p>
            ) : (
              <p>The directory is temporarily unreachable. Please try the search again in a moment.</p>
            )}
          </EmptyState>
        </div>
      ) : results && results.total === 0 ? (
        <div className="mt-10">
          <EmptyState
            mark="&#8981;"
            title="No businesses matched this search"
            action={
              <ButtonLink tone="cta" href="/login">
                List your business <span aria-hidden="true">&rarr;</span>
              </ButtonLink>
            }
          >
            <p>
              Try a different keyword, pick a wider category, or clear the area filter. Only approved listings appear
              in public results.
            </p>
          </EmptyState>
        </div>
      ) : results ? (
        <>
          <p className="mt-8 text-sm text-muted" aria-live="polite">
            <strong className="text-lg font-black text-brand-700">{results.total}</strong>{" "}
            {results.total === 1 ? "business" : "businesses"} found
            {criteria.sort === "distance" ? ", closest first" : ""}
          </p>

          {results.items.length === 0 ? (
            // A page number past the end: the total above still tells the visitor what exists.
            <div className="mt-6">
              <EmptyState
                mark="&#8644;"
                title="This page is past the end"
                action={<ButtonLink href={searchWithout(raw)}>Back to the first page</ButtonLink>}
              >
                <p>There are results for this search, just not this far in.</p>
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {results.items.map((listing) => (
                <ListingCard key={listing.url} listing={listing} />
              ))}
            </ul>
          )}

          <Pagination
            page={results.page}
            totalPages={results.totalPages}
            params={raw as Record<string, string | undefined>}
            basePath="/search"
          />

          <p className="mt-10 text-center text-sm text-muted">
            Cannot find a business?{" "}
            <Link href="/login" className="font-bold text-brand-700 hover:underline">
              Add it to Hyderabad Links
            </Link>
            .
          </p>
        </>
      ) : null}
    </main>
  );
}
