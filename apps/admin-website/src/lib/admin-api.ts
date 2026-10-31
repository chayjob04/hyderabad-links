import { redirect } from "next/navigation";
import { readTokens } from "./session";
import type { SessionTokens } from "./session-cookies";

// Server-side only. The browser never calls the API: server components and server actions do,
// attaching the admin's token from the httpOnly cookie.
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:5080";

export type AdminProfile = {
  id: number;
  email: string;
  displayName: string;
  roles: string[];
  /** What this admin may do. The API checks every permission again; this only decides what to draw. */
  permissions: string[];
};

export type QueueItem = {
  id: number;
  name: string;
  status: string;
  categoryName: string | null;
  localityName: string;
  addressLine: string | null;
  phonePrimary: string;
  createdAt: string;
  updatedAt: string;
  /** Paid up right now, from the entitlement view — not what the listing once bought. */
  isVerified: boolean;
  paidUntil: string | null;
};

export type QueuePage = {
  items: QueueItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AdminListing = {
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
  /** Paid up right now, from the entitlement view — not what the listing once bought. */
  isVerified: boolean;
  paidUntil: string | null;
};

/** Permission codes used by these screens. They must match BusinessDirectory.Api.Auth.AdminPermissions. */
export const PERMISSION_VIEW = "listings.view";
export const PERMISSION_REVIEW = "listings.review";
/** Categories, subcategories and localities. Adding or editing a listing is super-admin work now. */
export const PERMISSION_TAXONOMY = "taxonomy.manage";
/** The seeded description of this one already reads "Handle abuse reports and reviews". */
export const PERMISSION_REPORTS = "reports.handle";
/** Writing to an owner to ask them to correct something (S0017). Admin work, unlike deleting. */
export const PERMISSION_ALERT = "listings.alert";

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

/** Calls an admin endpoint with the signed-in admin's token. No token, or a rejected token, means sign in again. */
async function authed<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const { access } = await readTokens();
  if (!access) redirect("/login/reset");
  const result = await send<T>(path, init, access);
  if (!result.ok && result.status === 401) redirect("/login/reset");
  return result;
}

const json = (value: unknown): string => JSON.stringify(value);

// ---- sign in (no token needed)
/**
 * A correct password no longer returns a session. MFA is mandatory, so it returns a short-lived
 * token for the second step: `stage` is "mfa" when the admin already has an authenticator and
 * "enroll" when they must set one up, which is every admin's first sign-in.
 */
export type MfaRequired = { stage: "mfa" | "enroll"; mfaToken: string; expiresInSeconds: number };

/** `secret` is Base32, for typing in when a QR code cannot be scanned. */
export type Enrollment = { secret: string; otpauthUri: string };

/** Recovery codes come back exactly once, at enrollment, and can never be retrieved again. */
export type Enrolled = SessionTokens & { recoveryCodes: string[] };

export const adminLogin = (email: string, password: string) =>
  send<MfaRequired>("/api/v1/auth/admin/login", { method: "POST", body: json({ email, password }) });

// The second step. Each of these is reachable only with the token the password step returned,
// because the API gives that token a different audience from a real admin token.
export const startEnrollment = (mfaToken: string) =>
  send<Enrollment>("/api/v1/auth/admin/mfa/enroll/start", { method: "POST" }, mfaToken);

export const confirmEnrollment = (mfaToken: string, code: string) =>
  send<Enrolled>("/api/v1/auth/admin/mfa/enroll/confirm", { method: "POST", body: json({ code }) }, mfaToken);

export const verifyMfa = (mfaToken: string, input: { code?: string; recoveryCode?: string }) =>
  send<SessionTokens>("/api/v1/auth/admin/mfa/verify", { method: "POST", body: json(input) }, mfaToken);

export const adminLogout = (refreshToken: string) =>
  send<void>("/api/v1/auth/admin/logout", { method: "POST", body: json({ refreshToken }) });

// ---- signed-in admin
export const getAdminProfile = () => authed<AdminProfile>("/api/v1/admin/me");

export const getQueue = (status: string, page: number) =>
  authed<QueuePage>(`/api/v1/admin/listings?status=${encodeURIComponent(status)}&page=${page}`);

export const getListing = (id: number) => authed<AdminListing>(`/api/v1/admin/listings/${id}`);

export const approveListing = (id: number) =>
  authed<AdminListing>(`/api/v1/admin/listings/${id}/approve`, { method: "POST" });

export const rejectListing = (id: number, reason: string) =>
  authed<AdminListing>(`/api/v1/admin/listings/${id}/reject`, { method: "POST", body: json({ reason }) });

/** The statuses an admin can filter by, in the order the tabs appear. Mirrors ModerationQueueQuery. */
/** One review waiting on a moderator. The reviewer is identified by phone, which is not public. */
export type ModerationReview = {
  id: number;
  listingId: number;
  listingName: string;
  rating: number;
  body: string;
  reviewerPhone: string;
  createdAt: string;
};

export type ModerationReviewPage = {
  items: ModerationReview[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const getReviewQueue = (status: string, page: number) =>
  authed<ModerationReviewPage>(
    '/api/v1/admin/reviews?status=' + encodeURIComponent(status) + '&page=' + page,
  );

export const approveReview = (id: number) =>
  authed<void>('/api/v1/admin/reviews/' + id + '/approve', {
    method: 'POST',
    body: JSON.stringify({ note: null }),
  });

/** The note is what the reviewer reads, so a rejection should always carry one. */
export const rejectReview = (id: number, note: string) =>
  authed<void>('/api/v1/admin/reviews/' + id + '/reject', {
    method: 'POST',
    body: JSON.stringify({ note: note.trim() === '' ? null : note.trim() }),
  });

/** Takes a live listing off the public site. The reason is shown to the owner. */
export const suspendListing = (id: number, reason: string) =>
  authed<AdminListing>('/api/v1/admin/listings/' + id + '/suspend', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const reinstateListing = (id: number) =>
  authed<AdminListing>('/api/v1/admin/listings/' + id + '/reinstate', { method: 'POST' });

/** One abuse report. `subjectName` is the business it is about, whichever kind of subject it is. */
export type AbuseReport = {
  id: number;
  subjectType: "listing" | "review";
  subjectId: number;
  subjectName: string;
  reviewBody: string | null;
  reason: string;
  details: string | null;
  status: string;
  resolutionNote: string | null;
  createdAt: string;
};

export type AbuseReportPage = {
  items: AbuseReport[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const REPORT_STATUSES = ["open", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The API's reason codes, in plain words for the queue. */
export const REPORT_REASON_LABELS: Record<string, string> = {
  not_a_real_business: "Not a real business",
  wrong_details: "The details are wrong",
  closed_down: "Closed down",
  offensive_content: "Offensive content",
  spam: "Spam",
  other: "Something else",
};

export const getReportQueue = (status: string, page: number) =>
  authed<AbuseReportPage>(
    '/api/v1/admin/reports?status=' + encodeURIComponent(status) + '&page=' + page,
  );

/** Records that something was done about the subject. Acting on it is a separate, audited action. */
export const actionReport = (id: number, note: string) =>
  authed<void>('/api/v1/admin/reports/' + id + '/action', {
    method: 'POST',
    body: JSON.stringify({ note: note.trim() === '' ? null : note.trim() }),
  });

export const dismissReport = (id: number, note: string) =>
  authed<void>('/api/v1/admin/reports/' + id + '/dismiss', {
    method: 'POST',
    body: JSON.stringify({ note: note.trim() === '' ? null : note.trim() }),
  });

export const QUEUE_STATUSES = ["pending_review", "active", "rejected", "draft", "suspended"] as const;

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
    default:
      return { label: status, tone: "grey" };
  }
}

/** Short, unambiguous date and time for a reviewer. Rendered on the server, so the zone is the server's. */
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

// ---- the taxonomy: categories, subcategories and Hyderabad's localities
// These are admin endpoints, not the public ones: they list inactive rows too, because this is the
// screen where an admin turns one back on, and they carry the listing counts the delete button needs.
export type AdminCategory = {
  id: number;
  level: number;
  parentId: number | null;
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** Listings on this category right now. Any at all, and it cannot be deleted. */
  listingCount: number;
  children: AdminCategory[];
};

export type AdminCity = { id: number; slug: string; name: string; state: string; isActive: boolean };

export type AdminLocality = {
  id: number;
  cityId: number;
  citySlug: string;
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  pincode: string | null;
  isActive: boolean;
  listingCount: number;
};

export const getAdminCategories = () => authed<AdminCategory[]>("/api/v1/admin/categories");
export const getAdminCities = () => authed<AdminCity[]>("/api/v1/admin/cities");
export const getAdminLocalities = () => authed<AdminLocality[]>("/api/v1/admin/localities");

/** The slug is built from the name by the API and never changes afterwards: see AdminTaxonomyEndpoints. */
export const createCategory = (input: { name: string; parentId: number | null; sortOrder: number }) =>
  authed<AdminCategory>("/api/v1/admin/categories", { method: "POST", body: json(input) });

/** Any field left out keeps its current value. */
export const updateCategory = (
  id: number,
  input: { name?: string; sortOrder?: number; isActive?: boolean },
) => authed<void>("/api/v1/admin/categories/" + id, { method: "PUT", body: json(input) });

export const deleteCategory = (id: number) =>
  authed<void>("/api/v1/admin/categories/" + id, { method: "DELETE" });

export const createLocality = (input: {
  citySlug: string;
  name: string;
  latitude: number;
  longitude: number;
  pincode: string | null;
}) => authed<AdminLocality>("/api/v1/admin/localities", { method: "POST", body: json(input) });

export const updateLocality = (
  id: number,
  input: { name?: string; latitude?: number; longitude?: number; pincode?: string | null; isActive?: boolean },
) => authed<void>("/api/v1/admin/localities/" + id, { method: "PUT", body: json(input) });

export const deleteLocality = (id: number) =>
  authed<void>("/api/v1/admin/localities/" + id, { method: "DELETE" });

// ---------------------------------------------------------------- alerts to business owners
/** A correction request sent to an owner. */
export type ListingAlert = {
  id: number;
  reason: string;
  reasonLabel: string;
  message: string;
  sentByName: string;
  createdAt: string;
  acknowledgedAt: string | null;
};

/**
 * The alerts on a listing, plus the reasons the API will accept.
 *
 * `reasons` is sent by the API rather than listed here so the dropdown is built from the same list
 * the API validates against and the database constrains. A reason hard-coded in this app would be
 * refused at the moment of sending, after the admin had written the whole message.
 */
export type ListingAlerts = { items: ListingAlert[]; reasons: Record<string, string> };

export const getListingAlerts = (id: number) =>
  authed<ListingAlerts>(`/api/v1/admin/listings/${id}/alerts`);

export const sendListingAlert = (id: number, reason: string, message: string) =>
  authed<ListingAlert>(`/api/v1/admin/listings/${id}/alerts`, {
    method: "POST",
    body: json({ reason, message }),
  });

// ---------------------------------------------------------------- blog
export const PERMISSION_BLOG = "blog.manage";
export const PERMISSION_SEO = "seo.manage";

export type BlogSummary = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  authorName: string;
  publishedAt: string | null;
  status: string;
};

export type BlogPost = BlogSummary & { bodyMarkdown: string };

export type BlogPage = { items: BlogSummary[]; page: number; totalPages: number; total: number };

export const getBlogPosts = (page: number) =>
  authed<BlogPage>(`/api/v1/admin/blog?page=${page}`);

export const getBlogPost = (id: number) => authed<BlogPost>(`/api/v1/admin/blog/${id}`);

export const createBlogPost = (input: {
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  coverImageUrl: string;
  publish: boolean;
}) => authed<{ id: number; slug: string }>("/api/v1/admin/blog", { method: "POST", body: json(input) });

/** The slug is never changed by an edit: a published post whose URL moves is a broken link. */
export const updateBlogPost = (
  id: number,
  input: { title: string; excerpt: string; bodyMarkdown: string; coverImageUrl: string },
) => authed<void>(`/api/v1/admin/blog/${id}`, { method: "PUT", body: json({ ...input, publish: false }) });

export const setBlogPostPublished = (id: number, published: boolean) =>
  authed<void>(`/api/v1/admin/blog/${id}/${published ? "publish" : "unpublish"}`, { method: "POST" });

// ---------------------------------------------------------------- SEO metadata
export type PageMeta = {
  id: number;
  entityType: string;
  entityId: number;
  pageKey: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  ogImageUrl: string | null;
  noindex: boolean;
  updatedAt: string;
};

/** `staticPages` is the fixed list of page keys the API accepts, so the form cannot offer more. */
export type PageMetaList = { items: PageMeta[]; staticPages: string[] };

export const getPageMetaList = () => authed<PageMetaList>("/api/v1/admin/seo");

export const savePageMeta = (
  entityType: string,
  key: string,
  input: {
    metaTitle: string;
    metaDescription: string;
    metaKeywords: string;
    ogImageUrl: string;
    noindex: boolean;
  },
) =>
  authed<PageMeta>(`/api/v1/admin/seo/${entityType}/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: json(input),
  });

/** Removing the override restores the metadata the page derives for itself. */
export const clearPageMeta = (entityType: string, key: string) =>
  authed<void>(`/api/v1/admin/seo/${entityType}/${encodeURIComponent(key)}`, { method: "DELETE" });

// ---------------------------------------------------------------- search tuning
export type SearchSynonym = { id: number; term: string; mapsTo: string; isActive: boolean };

export type SearchPlaceholder = { id: number; text: string; sortOrder: number; isActive: boolean };

export type SearchTuning = { synonyms: SearchSynonym[]; placeholders: SearchPlaceholder[] };

export const getSearchTuning = () => authed<SearchTuning>("/api/v1/admin/search");

export const addSynonym = (term: string, mapsTo: string) =>
  authed<SearchSynonym>("/api/v1/admin/search/synonyms", {
    method: "POST",
    body: json({ term, mapsTo, isActive: true }),
  });

export const deleteSynonym = (id: number) =>
  authed<void>(`/api/v1/admin/search/synonyms/${id}`, { method: "DELETE" });

export const addPlaceholder = (text: string, sortOrder: number) =>
  authed<SearchPlaceholder>("/api/v1/admin/search/placeholders", {
    method: "POST",
    body: json({ text, sortOrder, isActive: true }),
  });

export const deletePlaceholder = (id: number) =>
  authed<void>(`/api/v1/admin/search/placeholders/${id}`, { method: "DELETE" });
