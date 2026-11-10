import { redirect } from "next/navigation";
import { json, send, type ApiResult } from "./api-call";
import { readCustomerTokens } from "./customer-session";
import type { SessionTokens } from "./session-cookies";

// Server-side only. The browser never calls the API: server components and server actions do,
// attaching the customer's token from the httpOnly cookie.
//
// This is the customer half of the site: saving businesses, writing reviews, and the customer's own
// name and email. It talks to /api/v1/customer with a token in the `customer` audience, which the
// API refuses on every owner and staff route. The owner half is owner-api.ts and the two never
// share a token.

/** The signed-in customer. No `needsOnboarding`: a customer never registers anything. */
export type CustomerProfile = {
  id: number;
  phone: string;
  name: string | null;
  email: string | null;
};

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

/**
 * Calls a customer endpoint with the signed-in customer's token. No token or a rejected token sends
 * them to sign in again — on the customer tab, because that is the account that was missing.
 */
async function authed<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const { access } = await readCustomerTokens();
  if (!access) redirect("/login/reset?tab=user");
  const result = await send<T>(path, init, access);
  if (!result.ok && result.status === 401) redirect("/login/reset?tab=user");
  return result;
}

// ---- sign in (no token needed)
export const requestCustomerOtp = (phone: string) =>
  send<{ expiresInSeconds: number; resendAfterSeconds: number }>("/api/v1/auth/customer/otp/request", {
    method: "POST",
    body: json({ phone }),
  });

export const verifyCustomerOtp = (phone: string, code: string) =>
  send<SessionTokens>("/api/v1/auth/customer/otp/verify", { method: "POST", body: json({ phone, code }) });

export const logoutCustomerSession = (refreshToken: string) =>
  send<void>("/api/v1/auth/customer/logout", { method: "POST", body: json({ refreshToken }) });

// ---- signed-in customer
export const getCustomer = () => authed<CustomerProfile>("/api/v1/customer");

export const updateCustomerProfile = (input: { name: string; email: string }) =>
  authed<{ phone: string; name: string; email: string }>("/api/v1/customer/profile", {
    method: "PUT",
    body: json(input),
  });

/**
 * The signed-in customer, or null when nobody is. `getCustomer` redirects when there is no usable
 * token, which is right on a customer page and wrong in the site header: every public page would
 * bounce a logged-out visitor to the login screen. This answers the question instead of acting on
 * it, and never throws — a header must render even when the API is down.
 */
export async function getCustomerIfSignedIn(): Promise<CustomerProfile | null> {
  const { access } = await readCustomerTokens();
  if (!access) return null;
  const result = await send<CustomerProfile>("/api/v1/customer", {}, access);
  return result.ok ? result.data : null;
}

// ---- saved businesses
const favouritePath = (target: { city: string; locality: string; slug: string }) =>
  "/api/v1/customer/favourites/" + [target.city, target.locality, target.slug].map(encodeURIComponent).join("/");

export const listFavourites = () => authed<Favourite[]>("/api/v1/customer/favourites");

/** PUT, not POST: saving one that is already saved is the same favourite. */
export const saveFavourite = (target: { city: string; locality: string; slug: string }) =>
  authed<void>(favouritePath(target), { method: "PUT" });

export const forgetFavourite = (target: { city: string; locality: string; slug: string }) =>
  authed<void>(favouritePath(target), { method: "DELETE" });

// ---- reviews
export const submitReview = (
  target: { city: string; locality: string; slug: string },
  input: { rating: number; body: string },
) =>
  authed<{ id: number; status: string }>(
    `/api/v1/customer/reviews/${[target.city, target.locality, target.slug].map(encodeURIComponent).join("/")}`,
    { method: "POST", body: json(input) },
  );

export const listMyReviews = () => authed<MyReview[]>("/api/v1/customer/reviews");
