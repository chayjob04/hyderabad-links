import { redirect } from "next/navigation";
import { readTokens } from "./session";
import type { SessionTokens } from "./session-cookies";

// Server-side only. The browser never calls the API: server components and server actions do,
// attaching the owner's token from the httpOnly cookie.
import { API_BASE_URL } from "./api-base";
export type OwnerListing = {
  id: number;
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
  localitySlug: string;
  localityName: string;
  categorySlug: string;
  categoryName: string;
  status: string;
  /** Why a reviewer rejected it. Shown to the owner so they know what to fix. */
  reviewNote: string | null;
  reviewedAt: string | null;
  url: string;
};

/** `needsOnboarding` is the API's own rule (an owner with no name has not registered yet), not ours. */
export type OwnerProfile = {
  id: number;
  phone: string;
  name: string | null;
  email: string | null;
  needsOnboarding: boolean;
};

/**
 * The dashboard's figures. Every number is counted from the owner's own rows; there is deliberately
 * nothing here about views, leads or ratings, because no table records them.
 */
export type OwnerOverview = {
  listings: {
    total: number;
    active: number;
    pendingReview: number;
    draft: number;
    rejected: number;
    suspended: number;
  };
  profile: {
    completed: number;
    total: number;
    steps: { key: string; label: string; done: boolean }[];
  };
};

/** What the one-time registration form sends. */
export type OnboardingInput = {
  name: string;
  email: string;
  businessName: string;
  localitySlug: string;
  categorySlug: string;
};

/** `created` is false when the request was a repeat and the account already existed. */
export type OnboardingResult = { name: string; email: string; listingId: number | null; created: boolean };

/** What the listing form sends. The API trims and validates everything again. */
export type ListingFormInput = {
  name: string;
  description: string;
  categorySlug: string;
  localitySlug?: string;
  addressLine: string;
  pincode: string;
  phonePrimary: string;
  phoneWhatsapp: string;
  websiteUrl: string;
};

export type ApiFailure = { ok: false; status: number; message: string; fieldErrors: Record<string, string> };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

async function toFailure(response: Response): Promise<ApiFailure> {
  let message = "Something went wrong. Please try again.";
  const fieldErrors: Record<string, string> = {};
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
  return { ok: false, status: response.status, message, fieldErrors };
}

async function send<T>(path: string, init: RequestInit, accessToken?: string): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    return { ok: false, status: 0, message: "We could not reach the server. Please try again in a moment.", fieldErrors: {} };
  }
  if (!response.ok) return toFailure(response);
  if (response.status === 204) return { ok: true, data: undefined as T };
  return { ok: true, data: (await response.json()) as T };
}

/** Calls an owner endpoint with the signed-in owner's token. No token or a rejected token sends the person to sign in again. */
async function authed<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const { access } = await readTokens();
  if (!access) redirect("/login/reset");
  const result = await send<T>(path, init, access);
  if (!result.ok && result.status === 401) redirect("/login/reset");
  return result;
}

const json = (value: unknown): string => JSON.stringify(value);
const orNull = (value: string | undefined) => (value && value.trim() !== "" ? value.trim() : null);

function toPayload(input: ListingFormInput) {
  return {
    name: orNull(input.name),
    description: orNull(input.description),
    categorySlug: orNull(input.categorySlug),
    localitySlug: orNull(input.localitySlug),
    addressLine: orNull(input.addressLine),
    pincode: orNull(input.pincode),
    phonePrimary: orNull(input.phonePrimary),
    phoneWhatsapp: orNull(input.phoneWhatsapp),
    websiteUrl: orNull(input.websiteUrl),
  };
}

// ---- sign in (no token needed)
export const requestOtp = (phone: string) =>
  send<{ expiresInSeconds: number; resendAfterSeconds: number }>("/api/v1/auth/owner/otp/request", {
    method: "POST",
    body: json({ phone }),
  });

export const verifyOtp = (phone: string, code: string) =>
  send<SessionTokens>("/api/v1/auth/owner/otp/verify", { method: "POST", body: json({ phone, code }) });

export const logoutSession = (refreshToken: string) =>
  send<void>("/api/v1/auth/owner/logout", { method: "POST", body: json({ refreshToken }) });

// ---- signed-in owner
export const getMe = () => authed<OwnerProfile>("/api/v1/me");

/**
 * Reads the profile with a token passed in directly, for the moment just after sign-in when the
 * cookie has been set but we would rather not depend on reading back what we only just wrote.
 */
export const getMeWithToken = (accessToken: string) => send<OwnerProfile>("/api/v1/me", {}, accessToken);

export const onboard = (input: OnboardingInput) =>
  authed<OnboardingResult>("/api/v1/me/onboarding", { method: "POST", body: json(input) });
/** One customer enquiry as its owner sees it. The phone is private customer data. */
export type OwnerEnquiry = {
  id: number;
  listingId: number;
  listingName: string;
  name: string;
  phone: string;
  email: string | null;
  message: string;
  status: string;
  createdAt: string;
};

export type OwnerEnquiryPage = {
  items: OwnerEnquiry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Unread across every listing, not just this page. */
  newCount: number;
};

export const getOverview = () => authed<OwnerOverview>("/api/v1/me/overview");

export const updateProfile = (input: { name: string; email: string }) =>
  authed<{ phone: string; name: string; email: string }>("/api/v1/me/profile", { method: "PUT", body: json(input) });

export const listEnquiries = (options: { status?: string; page?: number } = {}) => {
  const query = new URLSearchParams();
  if (options.status) query.set('status', options.status);
  if (options.page && options.page > 1) query.set('page', String(options.page));
  const suffix = query.toString();
  return authed<OwnerEnquiryPage>('/api/v1/me/enquiries' + (suffix ? '?' + suffix : ''));
};

export const setEnquiryStatus = (id: number, status: string) =>
  authed<void>('/api/v1/me/enquiries/' + id + '/status', { method: 'PUT', body: json({ status }) });

/** A review this person wrote, including what moderation decided about it. */
export type MyReview = {
  id: number;
  listingId: number;
  listingName: string;
  url: string;
  rating: number;
  body: string;
  status: string;
  moderationNote: string | null;
  createdAt: string;
};

export const submitReview = (
  target: { city: string; locality: string; slug: string },
  input: { rating: number; body: string },
) =>
  authed<{ id: number; status: string }>(
    `/api/v1/me/reviews/${[target.city, target.locality, target.slug].map(encodeURIComponent).join("/")}`,
    { method: "POST", body: json(input) },
  );

export const listMyReviews = () => authed<MyReview[]>("/api/v1/me/reviews");

/**
 * A listing this person saved. `isAvailable` is false once it stops being live: the entry is
 * kept, because they saved it, but it is not offered as somewhere to go.
 */
export type Favourite = {
  listingId: number;
  name: string;
  categoryName: string;
  localityName: string;
  phonePrimary: string;
  url: string;
  logoUrl: string | null;
  isAvailable: boolean;
  savedAt: string;
};

const favouritePath = (target: { city: string; locality: string; slug: string }) =>
  "/api/v1/me/favourites/" + [target.city, target.locality, target.slug].map(encodeURIComponent).join("/");

export const listFavourites = () => authed<Favourite[]>("/api/v1/me/favourites");

/** PUT, not POST: saving one that is already saved is the same favourite. */
export const saveFavourite = (target: { city: string; locality: string; slug: string }) =>
  authed<void>(favouritePath(target), { method: "PUT" });

export const forgetFavourite = (target: { city: string; locality: string; slug: string }) =>
  authed<void>(favouritePath(target), { method: "DELETE" });

export const listMyListings = () => authed<OwnerListing[]>("/api/v1/me/listings");
export const getMyListing = (id: number) => authed<OwnerListing>(`/api/v1/me/listings/${id}`);
export const createListing = (input: ListingFormInput) =>
  authed<OwnerListing>("/api/v1/me/listings", { method: "POST", body: json(toPayload(input)) });
export const updateListing = (id: number, input: ListingFormInput) =>
  authed<OwnerListing>(`/api/v1/me/listings/${id}`, { method: "PUT", body: json(toPayload({ ...input, localitySlug: undefined })) });
export const submitListing = (id: number) => authed<OwnerListing>(`/api/v1/me/listings/${id}/submit`, { method: "POST" });

/** One photo, logo or video on a listing. `url` is the address the browser loads the file from. */
export type ListingMediaItem = {
  id: number;
  kind: "logo" | "photo" | "video";
  url: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  sortOrder: number;
  /** Hidden after a downgrade: kept, but not shown on the public page (decision D10). */
  isHidden: boolean;
  createdAt: string;
};

/**
 * What the listing's plan allows and what it has used.
 * `limitsConfirmed` is false while the per-tier allowances are still provisional, and the screen
 * says so rather than presenting an unconfirmed number as a promise.
 */
export type ListingMediaAllowance = {
  planSlug: string;
  planName: string;
  photoLimit: number;
  videoLimit: number;
  logoLimit: number;
  photosUsed: number;
  videosUsed: number;
  logosUsed: number;
  limitsConfirmed: boolean;
  uploadsAvailable: boolean;
};

export type ListingMedia = { allowance: ListingMediaAllowance; items: ListingMediaItem[] };

export const getListingMedia = (id: number) => authed<ListingMedia>(`/api/v1/me/listings/${id}/media`);

/** Moves one photo one place earlier or later within its own kind. */
export const moveListingMedia = (id: number, mediaId: number, direction: "up" | "down") =>
  authed<void>(`/api/v1/me/listings/${id}/media/${mediaId}/move?direction=${direction}`, { method: "POST" });

export const deleteListingMedia = (id: number, mediaId: number) =>
  authed<void>(`/api/v1/me/listings/${id}/media/${mediaId}`, { method: "DELETE" });

/** One website or social link on a listing. */
export type ListingLinkItem = {
  id: number;
  linkType: ListingLinkType;
  label: string;
  url: string;
  sortOrder: number;
};

export type ListingLinkType =
  | "website"
  | "instagram"
  | "facebook"
  | "youtube"
  | "linkedin"
  | "x"
  | "other";

/**
 * What this listing may do with links right now.
 *
 * `limit` is 5 on a paid listing and 0 otherwise, and the API works it out from the subscription
 * period against the clock — so a lapsed listing reports 0 here without anything on this side
 * having to reason about expiry. `paidUntil` is what lets the screen say when it runs out.
 */
export type ListingLinkAllowance = {
  planSlug: string;
  planName: string;
  limit: number;
  used: number;
  verified: boolean;
  paidUntil: string | null;
};

export type ListingLinks = { allowance: ListingLinkAllowance; items: ListingLinkItem[] };

export const getListingLinks = (id: number) =>
  authed<ListingLinks>(`/api/v1/me/listings/${id}/links`);

export const addListingLink = (
  id: number,
  link: { linkType: string; label: string; url: string },
) =>
  authed<ListingLinkItem>(`/api/v1/me/listings/${id}/links`, {
    method: "POST",
    body: json(link),
  });

export const deleteListingLink = (id: number, linkId: number) =>
  authed<void>(`/api/v1/me/listings/${id}/links/${linkId}`, { method: "DELETE" });

/**
 * Sends the file to the API. Written out rather than going through `send`, because that sets a JSON
 * content type: a multipart body must keep the boundary fetch generates for it.
 */
export async function uploadListingMedia(
  id: number,
  kind: "logo" | "photo" | "video",
  file: File,
): Promise<ApiResult<ListingMediaItem>> {
  const { access } = await readTokens();
  if (!access) redirect("/login/reset");

  const body = new FormData();
  body.set("kind", kind);
  body.set("file", file);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/me/listings/${id}/media`, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${access}` },
      body,
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: "We could not reach the server. Please try again in a moment.", fieldErrors: {} };
  }

  if (response.status === 401) redirect("/login/reset");
  if (!response.ok) return toFailure(response);
  return { ok: true, data: (await response.json()) as ListingMediaItem };
}

/** Plain-language status for the owner. */
export function describeStatus(status: string): { label: string; tone: "grey" | "amber" | "green" | "red"; help: string } {
  switch (status) {
    case "draft":
      return { label: "Draft", tone: "grey", help: "Only you can see this. Add the address and a description, then submit it for review." };
    case "pending_review":
      return { label: "In review", tone: "amber", help: "We are checking your listing. It will appear on the site once approved." };
    case "active":
      return { label: "Live", tone: "green", help: "Visible to everyone on the site." };
    case "rejected":
      return { label: "Needs changes", tone: "red", help: "We could not publish it as it is. Make the change below, then submit it again." };
    case "suspended":
      return { label: "Suspended", tone: "red", help: "This listing is hidden. Please contact support." };
    default:
      return { label: status, tone: "grey", help: "" };
  }
}
