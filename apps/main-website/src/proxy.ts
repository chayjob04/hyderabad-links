import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, refreshCookieOptions } from "@/lib/session-cookies";
import {
  CUSTOMER_ACCESS_COOKIE,
  CUSTOMER_REFRESH_COOKIE,
  customerAccessCookieOptions,
  customerRefreshCookieOptions,
} from "@/lib/customer-session-cookies";
import { API_BASE_URL } from "@/lib/api-base";

/**
 * Runs before every signed-in page, on either side of the site. Access tokens last 15 minutes: when
 * the access cookie is gone but the refresh cookie is still there, swap it for a fresh pair here —
 * the only place that can set cookies before a render.
 *
 * There are two realms behind one middleware, because Next.js allows exactly one per application.
 * Which one applies is decided by the path prefix and nothing else:
 *
 *     /account/*   business owner   hl_access   / hl_refresh    -> /api/v1/auth/owner/refresh
 *     /my/*        customer         hl_cust_*   cookies         -> /api/v1/auth/customer/refresh
 *
 * Crossing the two would be a real fault, not a cosmetic one: refreshing an owner cookie against the
 * customer endpoint would fail, and — worse — a customer who reached /account would be handed an
 * owner session they never had. The realm is chosen once, at the top, and everything below uses it.
 */
type Realm = {
  access: string;
  refresh: string;
  refreshPath: string;
  loginTab: string;
  accessOptions: (expiresInSeconds: number) => object;
  refreshOptions: object;
};

const OWNER: Realm = {
  access: ACCESS_COOKIE,
  refresh: REFRESH_COOKIE,
  refreshPath: "/api/v1/auth/owner/refresh",
  loginTab: "business",
  accessOptions: accessCookieOptions,
  refreshOptions: refreshCookieOptions,
};

const CUSTOMER: Realm = {
  access: CUSTOMER_ACCESS_COOKIE,
  refresh: CUSTOMER_REFRESH_COOKIE,
  refreshPath: "/api/v1/auth/customer/refresh",
  loginTab: "user",
  accessOptions: customerAccessCookieOptions,
  refreshOptions: customerRefreshCookieOptions,
};

function realmFor(pathname: string): Realm {
  return pathname === "/my" || pathname.startsWith("/my/") ? CUSTOMER : OWNER;
}

function toLogin(request: NextRequest, realm: Realm): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("tab", realm.loginTab);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.redirect(url);
  // Only this realm's cookies are cleared. Somebody holding both sessions must not be signed out of
  // the other one because this one expired.
  response.cookies.delete(realm.access);
  response.cookies.delete(realm.refresh);
  return response;
}

export async function proxy(request: NextRequest) {
  const realm = realmFor(request.nextUrl.pathname);

  if (request.cookies.get(realm.access)?.value) return NextResponse.next();

  const refresh = request.cookies.get(realm.refresh)?.value;
  if (!refresh) return toLogin(request, realm);

  // Link prefetches must not use up the one-time refresh token (the API treats reuse as theft and signs everyone out).
  const isPrefetch = request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
  if (isPrefetch) return NextResponse.next();

  let result: { accessToken: string; refreshToken: string; expiresInSeconds: number } | null = null;
  try {
    const response = await fetch(`${API_BASE_URL}${realm.refreshPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: "no-store",
    });
    if (response.ok) result = await response.json();
    else if (response.status !== 401) return NextResponse.next(); // API trouble: do not sign the person out for it
  } catch {
    return NextResponse.next();
  }
  if (!result) return toLogin(request, realm);

  // Make the new tokens visible to this request's page render, and store them in the browser.
  request.cookies.set(realm.access, result.accessToken);
  request.cookies.set(realm.refresh, result.refreshToken);
  const response = NextResponse.next({ request });
  response.cookies.set(realm.access, result.accessToken, realm.accessOptions(result.expiresInSeconds));
  response.cookies.set(realm.refresh, result.refreshToken, realm.refreshOptions);
  return response;
}

export const config = { matcher: ["/account/:path*", "/my/:path*"] };
