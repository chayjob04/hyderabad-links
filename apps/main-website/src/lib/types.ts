// Shapes returned by the API (camelCase JSON). Keep in sync with backend/BusinessDirectory.Api/Endpoints.
// Later these come from the generated OpenAPI client in packages/api-client.

export type SubCategory = { slug: string; name: string; searchTerms: string[] };
export type Category = { slug: string; name: string; children: SubCategory[] };
export type Locality = { slug: string; name: string; latitude: number; longitude: number };

/** One row from /api/v1/public/localities/search, for the location autocomplete. */
export type LocalitySuggestion = { slug: string; name: string; cityName: string; state: string };

/** /api/v1/public/localities/nearest: the known area closest to a point, and how far away it is. */
export type NearestLocality = LocalitySuggestion & { distanceMetres: number };

export type ListingDetail = {
  slug: string;
  name: string;
  description: string | null;
  addressLine: string | null;
  pincode: string | null;
  phonePrimary: string;
  phoneWhatsapp: string | null;
  websiteUrl: string | null;
  latitude: number;
  longitude: number;
  citySlug: string;
  cityName: string;
  localitySlug: string;
  localityName: string;
  categorySlug: string;
  categoryName: string;
  url: string;
  /** Logo first, then photos, then video. Media the plan no longer covers is not in this list at all. */
  media: ListingMedia[];
};

/** One file on a public listing page. */
export type ListingMedia = {
  kind: "logo" | "photo" | "video";
  url: string;
  width: number | null;
  height: number | null;
};

/** One URL for the sitemap. `lastModified` is only known for listings. */
export type SitemapEntry = { url: string; lastModified: string | null };

/** `truncated` is true when there are more live listings than one sitemap file may hold. */
export type Sitemap = {
  listings: SitemapEntry[];
  localities: SitemapEntry[];
  categories: SitemapEntry[];
  truncated: boolean;
};

/** Flat, search-friendly view of the category tree (sub-categories first, then parents). */
export type SearchCategory = { slug: string; name: string; terms: string[] };

/** One row from /api/v1/public/listings/search. distanceMetres is null unless lat/lng were sent. */
export type SearchListing = {
  slug: string;
  name: string;
  citySlug: string;
  localitySlug: string;
  localityName: string;
  categorySlug: string;
  categoryName: string;
  distanceMetres: number | null;
  addressLine: string | null;
  phonePrimary: string;
  phoneWhatsapp: string | null;
  url: string;
  /** The uploaded logo, or null when there is none - the card then shows a monogram. */
  logoUrl: string | null;
  /** The first photo, used as the card image when there is no logo. */
  photoUrl: string | null;
};

/** A page of search results. `total` counts every match, not just this page. */
export type SearchResults = {
  items: SearchListing[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/** What the visitor asked for. Mirrors the query string so filters stay shareable. */
export type SearchCriteria = {
  q?: string;
  city?: string;
  locality?: string;
  category?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sort?: "relevance" | "distance" | "name";
  page?: number;
  pageSize?: number;
};

/** Re-exported from the API client so components can import review shapes from one place. */
export type { PublicReview, ReviewSummary } from "./api";

/**
 * One card on a homepage shelf. The same fields as a search result minus the distance (a shelf is
 * not a proximity search), plus whether a paid period is running.
 */
export type HighlightListing = Omit<SearchListing, "distanceMetres"> & {
  /** True while the listing has a paid Verified period. Drives the badge. */
  verified: boolean;
};

export type Highlights = {
  /** Listings paying for prominence right now, newest first. */
  featured: HighlightListing[];
  /** Listings with the most real activity (enquiries, favourites, approved reviews) in the window. */
  trending: HighlightListing[];
  /** How many days back "trending" measured, so the heading can say it without hard-coding it. */
  trendingWindowDays: number;
};
