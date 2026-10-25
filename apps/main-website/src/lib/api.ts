import type {
  Category,
  Highlights,
  ListingDetail,
  Locality,
  LocalitySuggestion,
  NearestLocality,
  SearchCriteria,
  SearchResults,
  Sitemap,
} from "./types";

// Server-side only: the browser never calls the API directly (architecture principle 1).
// Read at runtime, so one build works in staging and production. See api-base.ts for why the
// precedence between the two variables matters.
import { API_BASE_URL } from "./api-base";
/**
 * Thrown when the API answered, but with an error status. The status is carried so a caller can tell
 * "the directory is broken" from "we could not reach the directory" -- those read identically to a
 * visitor otherwise, and the search page spent a production outage telling people the API was
 * unreachable while it was in fact answering 500s promptly.
 */
export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`API request ${path} failed with status ${status}`);
    this.name = "ApiResponseError";
  }
}

async function getJson<T>(path: string, revalidateSeconds: number): Promise<T | null> {
  const response = await fetch(`${API_BASE_URL}${path}`, { next: { revalidate: revalidateSeconds } });
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiResponseError(response.status, path);
  return (await response.json()) as T;
}

/**
 * The category tree, used by the site header on every page.
 *
 * This one swallows failures on purpose. The header renders everywhere, including the 404 page,
 * which Next.js prerenders at build time when no API is running (CI builds with no API at all).
 * A category list we cannot load should degrade to an empty menu, never take the whole page — or
 * the build — down with it. Pages that need categories to be meaningful check for an empty list.
 */
export async function getCategories(): Promise<Category[]> {
  try {
    return (await getJson<Category[]>("/api/v1/public/categories", 300)) ?? [];
  } catch {
    return [];
  }
}

/** Returns null when the city does not exist. */
export async function getLocalities(citySlug: string): Promise<Locality[] | null> {
  return getJson<Locality[]>(`/api/v1/public/cities/${encodeURIComponent(citySlug)}/localities`, 300);
}

/**
 * Partial-name locality lookup for the location autocomplete. Called by the route handler in
 * src/app/api/localities, never by the browser directly (architecture principle 1).
 *
 * The same fragment is typed by many visitors, so the answers are worth caching briefly; the
 * locality list itself changes only when the reference data does.
 */
export async function searchLocalities(text: string, city: string, limit = 8): Promise<LocalitySuggestion[]> {
  const query = new URLSearchParams({ q: text, city, limit: String(limit) });
  return (await getJson<LocalitySuggestion[]>(`/api/v1/public/localities/search?${query.toString()}`, 300)) ?? [];
}

/**
 * Resolves a visitor's coordinates to the nearest locality we know about, so "use my current
 * location" can show a real area name instead of raw numbers. Returns null when the API has no
 * active locality to offer.
 */
export async function getNearestLocality(lat: number, lng: number): Promise<NearestLocality | null> {
  const query = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  // Every visitor's coordinates differ, so caching these would fill the cache with single-use entries.
  return getJson<NearestLocality>(`/api/v1/public/localities/nearest?${query.toString()}`, 0);
}

/**
 * Database-backed listing search: keyword, category, locality, proximity, sorting and paging.
 * Throws when the API rejects the request or is unreachable, so the page can show an error state.
 */
export async function searchListings(criteria: SearchCriteria): Promise<SearchResults> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(criteria)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }
  const results = await getJson<SearchResults>(`/api/v1/public/listings/search?${query.toString()}`, 60);
  // The endpoint always answers 200, so null would mean a shape change rather than "not found".
  return results ?? { items: [], page: 1, pageSize: 0, total: 0, totalPages: 0 };
}

/**
 * The homepage's Featured and Trending shelves, in one request.
 *
 * Failures degrade to empty shelves rather than taking the homepage down, the same reasoning as
 * getCategories: the homepage is the page most likely to be hit while the API is restarting, and
 * two missing shelves are better than a 500. The page skips a shelf that comes back empty.
 */
export async function getHighlights(city: string): Promise<Highlights> {
  const empty: Highlights = { featured: [], trending: [], trendingWindowDays: 30 };
  try {
    const query = new URLSearchParams({ city });
    return (await getJson<Highlights>(`/api/v1/public/listings/highlights?${query.toString()}`, 300)) ?? empty;
  } catch {
    return empty;
  }
}

/** One approved review. The author is a first name only; nothing else is public. */
export type PublicReview = {
  id: number;
  rating: number;
  body: string;
  authorName: string;
  createdAt: string;
};

/** `average` is null when nothing has been approved yet, rather than 0, which would read as "rated zero". */
export type ReviewSummary = { average: number | null; count: number; items: PublicReview[] };

export async function getReviews(citySlug: string, localitySlug: string, slug: string): Promise<ReviewSummary> {
  const path = [citySlug, localitySlug, slug].map(encodeURIComponent).join("/");
  const summary = await getJson<ReviewSummary>(`/api/v1/public/listings/${path}/reviews`, 60);
  return summary ?? { average: null, count: 0, items: [] };
}

export type EnquiryFailure = { ok: false; message: string; fieldErrors: Record<string, string> };
export type EnquiryResult = { ok: true } | EnquiryFailure;

/**
 * Sends a customer enquiry to a business. Called from a server action, so the browser still never
 * talks to the API directly.
 *
 * Unlike the read helpers above this one reports failures instead of throwing: the person is in the
 * middle of filling in a form and needs to be told which field to fix.
 */
export async function sendEnquiry(
  target: { city: string; locality: string; slug: string },
  input: { name: string; phone: string; email: string; message: string },
): Promise<EnquiryResult> {
  const path = [target.city, target.locality, target.slug].map(encodeURIComponent).join("/");

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/public/listings/${path}/enquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...input, email: input.email || null }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "We could not reach the server. Please try again in a moment.", fieldErrors: {} };
  }

  if (response.ok) return { ok: true };

  const fieldErrors: Record<string, string> = {};
  let message = "We could not send your enquiry. Please try again.";
  try {
    const body = (await response.json()) as { detail?: unknown; errors?: Record<string, unknown> };
    if (body.errors && typeof body.errors === "object") {
      for (const [field, messages] of Object.entries(body.errors)) {
        if (Array.isArray(messages) && typeof messages[0] === "string") fieldErrors[field] = messages[0];
      }
      message = "Please fix the fields marked below.";
    } else if (typeof body.detail === "string") {
      message = body.detail;
    }
  } catch {
    // Not JSON: keep the generic message.
  }

  if (response.status === 404) {
    message = "This business is no longer taking enquiries.";
  }

  return { ok: false, message, fieldErrors };
}

/**
 * Every page the sitemap should list. Returns null instead of throwing when the API is
 * unreachable: a sitemap that is briefly short is better than one that answers 500.
 */
export async function getSitemap(): Promise<Sitemap | null> {
  try {
    return await getJson<Sitemap>("/api/v1/public/sitemap", 3600);
  } catch {
    return null;
  }
}

/** The reasons the API accepts. Shown in the form so the two cannot drift apart. */
export const REPORT_REASONS = [
  { value: "not_a_real_business", label: "This is not a real business" },
  { value: "wrong_details", label: "The details are wrong" },
  { value: "closed_down", label: "It has closed down" },
  { value: "offensive_content", label: "The content is offensive" },
  { value: "spam", label: "It is spam" },
  { value: "other", label: "Something else" },
] as const;

export type ReportResult = { ok: true } | { ok: false; message: string; fieldErrors: Record<string, string> };

/**
 * Reports a listing. Deliberately open to a visitor with no account: the people most likely to
 * spot a fake listing are the customers it tried to catch. The API counts the limits.
 */
export async function reportListing(
  target: { city: string; locality: string; slug: string },
  input: { reason: string; details: string },
): Promise<ReportResult> {
  const path = [target.city, target.locality, target.slug].map(encodeURIComponent).join("/");

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/public/listings/${path}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ reason: input.reason, details: input.details.trim() === "" ? null : input.details.trim() }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "We could not reach the server. Please try again in a moment.", fieldErrors: {} };
  }

  if (response.ok) return { ok: true };

  const fieldErrors: Record<string, string> = {};
  let message = "We could not send your report. Please try again.";
  try {
    const body = (await response.json()) as { detail?: unknown; errors?: Record<string, unknown> };
    if (body.errors && typeof body.errors === "object") {
      for (const [field, messages] of Object.entries(body.errors)) {
        if (Array.isArray(messages) && typeof messages[0] === "string") fieldErrors[field] = messages[0];
      }
      message = "Please fix the fields marked below.";
    } else if (typeof body.detail === "string") {
      message = body.detail;
    }
  } catch {
    // Not JSON: keep the generic message.
  }

  return { ok: false, message, fieldErrors };
}

export async function getListing(citySlug: string, localitySlug: string, slug: string): Promise<ListingDetail | null> {
  const path = [citySlug, localitySlug, slug].map(encodeURIComponent).join("/");
  return getJson<ListingDetail>(`/api/v1/public/listings/${path}`, 60);
}
