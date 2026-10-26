import { redirect } from "next/navigation";
import { readTokens } from "./session";
import type { SessionTokens } from "./session-cookies";

// Server-side only. The browser never calls the API: server components and server actions do,
// attaching the super-admin token from the httpOnly cookie.
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:5080";

export type SuperAdminProfile = {
  id: number;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
};

export type CountRow = { key: string; count: number };

export type Overview = {
  listingsByStatus: CountRow[];
  listingsByPlan: CountRow[];
  businesses: number;
  owners: number;
  adminAccounts: number;
  pendingReviews: number;
  openReports: number;
  newEnquiries: number;
};

export type AdminAccount = {
  id: number;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
  /** False until the account has set up an authenticator. It cannot sign in without one. */
  mfaEnrolled: boolean;
  unusedRecoveryCodes: number;
  lastSignInAt: string | null;
  createdAt: string;
};

export type Role = { slug: string; name: string; permissions: string[] };

export type AuditEntry = {
  id: number;
  occurredAt: string;
  actorType: string;
  /** Null when the account that acted has since been deleted: the log outlives it. */
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: string | null;
};

export type AuditPage = {
  items: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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
      message = Object.values(fieldErrors)[0] ?? "Please fix the fields marked below.";
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
    return { ok: false, status: 0, message: "We could not reach the API. Please try again in a moment.", fieldErrors: {} };
  }
  if (!response.ok) return toFailure(response);
  if (response.status === 204) return { ok: true, data: undefined as T };
  return { ok: true, data: (await response.json()) as T };
}

/** Calls a super-admin endpoint with the stored token. No token, or a rejected one, means sign in again. */
async function authed<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const { access } = await readTokens();
  if (!access) redirect("/login/reset");
  const result = await send<T>(path, init, access);
  if (!result.ok && result.status === 401) redirect("/login/reset");
  return result;
}

const json = (value: unknown): string => JSON.stringify(value);

// ---- sign in -----------------------------------------------------------------------------------
// Signing in uses the *admin* auth endpoints: there is one staff sign-in, and it is the same
// password and the same authenticator. What differs is which token this site keeps — see
// session-cookies.ts.

export type MfaRequired = { stage: "mfa" | "enroll"; mfaToken: string; expiresInSeconds: number };

export type Enrollment = { secret: string; otpauthUri: string };

/**
 * `superAdminAccessToken` is present only for an account holding `admins.manage`. An ordinary
 * administrator can sign in here and will be told they have no platform access, rather than being
 * shown a site whose every request would then be refused.
 */
export type StaffSession = SessionTokens & { superAdminAccessToken?: string | null };

export type Enrolled = StaffSession & { recoveryCodes: string[] };

export const staffLogin = (email: string, password: string) =>
  send<MfaRequired>("/api/v1/auth/admin/login", { method: "POST", body: json({ email, password }) });

export const startEnrollment = (mfaToken: string) =>
  send<Enrollment>("/api/v1/auth/admin/mfa/enroll/start", { method: "POST" }, mfaToken);

export const confirmEnrollment = (mfaToken: string, code: string) =>
  send<Enrolled>("/api/v1/auth/admin/mfa/enroll/confirm", { method: "POST", body: json({ code }) }, mfaToken);

export const verifyMfa = (mfaToken: string, input: { code?: string; recoveryCode?: string }) =>
  send<StaffSession>("/api/v1/auth/admin/mfa/verify", { method: "POST", body: json(input) }, mfaToken);

export const staffLogout = (refreshToken: string) =>
  send<void>("/api/v1/auth/admin/logout", { method: "POST", body: json({ refreshToken }) });

// ---- platform administration -----------------------------------------------------------------
export const getProfile = () => authed<SuperAdminProfile>("/api/v1/super-admin/me");
export const getOverview = () => authed<Overview>("/api/v1/super-admin/overview");
export const listAdmins = () => authed<AdminAccount[]>("/api/v1/super-admin/admins");
export const listRoles = () => authed<Role[]>("/api/v1/super-admin/roles");

export const setAdminRoles = (id: number, roles: string[]) =>
  authed<void>(`/api/v1/super-admin/admins/${id}/roles`, { method: "PUT", body: json({ roles }) });

export const setAdminStatus = (id: number, status: "active" | "disabled") =>
  authed<void>(`/api/v1/super-admin/admins/${id}/status`, { method: "PUT", body: json({ status }) });

export const resetAdminMfa = (id: number) =>
  authed<void>(`/api/v1/super-admin/admins/${id}/reset-mfa`, { method: "POST" });

export const getAudit = (options: { action?: string; entityType?: string; page?: number } = {}) => {
  const query = new URLSearchParams();
  if (options.action) query.set("action", options.action);
  if (options.entityType) query.set("entityType", options.entityType);
  if (options.page && options.page > 1) query.set("page", String(options.page));
  const suffix = query.toString();
  return authed<AuditPage>("/api/v1/super-admin/audit" + (suffix ? "?" + suffix : ""));
};

/** Dates in the format the rest of the staff tools use. */
export function formatWhen(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---- listings: add, correct, archive, delete
// These moved off the admin surface: an admin reviews what owners submit, and writing a listing is
// platform work. Mirrors BusinessDirectory.Api.Endpoints.SuperAdminListingEndpoints.
export const PERMISSION_LISTINGS_CREATE = "listings.create";
export const PERMISSION_LISTINGS_EDIT = "listings.edit";
export const PERMISSION_LISTINGS_DELETE = "listings.delete";

export type ListingRow = {
  id: number;
  name: string;
  slug: string;
  status: string;
  localityName: string;
  categoryName: string | null;
  phonePrimary: string;
  /** Paid up right now, from the entitlement view — not what the listing once bought. */
  isVerified: boolean;
  paidUntil: string | null;
  createdAt: string;
};

export type ListingPage = {
  items: ListingRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/** The same shape the admin site reads, because both surfaces describe a listing identically. */
export type ListingDetail = {
  id: number;
  slug: string;
  name: string;
  status: string;
  description: string | null;
  addressLine: string | null;
  pincode: string | null;
  phonePrimary: string;
  phoneWhatsapp: string | null;
  email: string | null;
  websiteUrl: string | null;
  latitude: number;
  longitude: number;
  citySlug: string;
  localitySlug: string;
  localityName: string;
  categorySlug: string | null;
  categoryName: string | null;
  submittedByPhone: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  url: string | null;
  isVerified: boolean;
  paidUntil: string | null;
};

export const LISTING_STATUSES = ["pending_review", "active", "rejected", "draft", "suspended", "archived"] as const;

export function describeStatus(status: string): { label: string; tone: "grey" | "amber" | "green" | "red" } {
  switch (status) {
    case "pending_review":
      return { label: "Waiting for review", tone: "amber" };
    case "active":
      return { label: "Live", tone: "green" };
    case "rejected":
      return { label: "Rejected", tone: "red" };
    case "draft":
      return { label: "Draft", tone: "grey" };
    case "suspended":
      return { label: "Suspended", tone: "red" };
    case "archived":
      return { label: "Archived", tone: "grey" };
    default:
      return { label: status, tone: "grey" };
  }
}

export const listListings = (options: { q?: string; status?: string; page?: number } = {}) => {
  const query = new URLSearchParams();
  if (options.q) query.set("q", options.q);
  if (options.status) query.set("status", options.status);
  query.set("page", String(options.page ?? 1));
  return authed<ListingPage>(`/api/v1/super-admin/listings?${query.toString()}`);
};

export const getListing = (id: number) => authed<ListingDetail>(`/api/v1/super-admin/listings/${id}`);

/** Takes a listing off the public site and keeps everything attached to it. Always available. */
export const archiveListing = (id: number) =>
  authed<void>(`/api/v1/super-admin/listings/${id}/archive`, { method: "POST" });

/**
 * Removes the listing outright. The API refuses this while a subscription or payment exists,
 * because those rows cascade and a financial record must not vanish with a listing.
 */
export const deleteListing = (id: number) =>
  authed<void>(`/api/v1/super-admin/listings/${id}`, { method: "DELETE" });

// ---- reference data for the listing form (public endpoints, no token needed)
export type SubCategory = { slug: string; name: string };
export type Category = { slug: string; name: string; children: SubCategory[] };
export type Locality = { slug: string; name: string };

/** The city the directory covers today. Localities are listed per city. */
export const DEFAULT_CITY = "hyderabad";

async function getPublic<T>(path: string, fallback: T): Promise<T> {
  const result = await send<T>(path, { method: "GET" });
  return result.ok ? result.data : fallback;
}

export const getCategories = () => getPublic<Category[]>("/api/v1/public/categories", []);
export const getLocalities = () => getPublic<Locality[]>(`/api/v1/public/cities/${DEFAULT_CITY}/localities`, []);

/** What the listing form sends. The API trims and validates every field again. */
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

export const createListing = (input: ListingFormInput) =>
  authed<ListingDetail>("/api/v1/super-admin/listings", { method: "POST", body: JSON.stringify(toPayload(input)) });

/** The area is fixed after creation — it is part of the public URL — so it is never sent on an edit. */
export const updateListing = (id: number, input: ListingFormInput) =>
  authed<ListingDetail>(`/api/v1/super-admin/listings/${id}`, {
    method: "PUT",
    body: JSON.stringify(toPayload({ ...input, localitySlug: undefined })),
  });
