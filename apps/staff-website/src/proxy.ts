import { NextResponse, type NextRequest } from "next/server";
import {
  accessCookieOptions,
  cookiesFor,
  refreshCookieOptions,
  surfaceForPath,
  type StaffSurface,
} from "@/lib/session-cookies";

/**
 * Runs before every signed-in staff page, on both surfaces. Access tokens last 15 minutes: when the
 * access cookie is gone but the refresh cookie is still there, swap it for a fresh pair here (the
 * only place that can set cookies before render). Same scheme as the public site's proxy.
 *
 * Next.js allows exactly one middleware per application, so the two that used to live in the admin
 * and super-admin apps are one file now. They are **not** one behaviour. The surface is taken from
 * the path, and the super-admin branch keeps its own rule:
 *
 *   an admin refresh returns an admin token, and may return a super-admin token as well — but only
 *   while the account still holds `admins.manage`, which the API re-reads from the database on
 *   every refresh.
 *
 * On /super-admin a refresh that comes back **without** that token ends the session. That is what
 * stops an account whose platform access was taken away from coasting on a live cookie until the
 * refresh token expires, and it is the one thing in this file that must not be simplified away.
 */
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:5080";

type RefreshResult = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  superAdminAccessToken?: string | null;
};

function toLogin(request: NextRequest, surface: StaffSurface): NextResponse {
  const names = cookiesFor(surface);
  const url = new URL("/login", request.url);
  url.searchParams.set("tab", surface === "super" ? "super" : "admin");
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.redirect(url);
  // Only this surface's cookies are cleared. Being signed out of one is not being signed out of both.
  response.cookies.delete(names.access);
  response.cookies.delete(names.refresh);
  return response;
}

export async function proxy(request: NextRequest) {
  const surface = surfaceForPath(request.nextUrl.pathname);
  const names = cookiesFor(surface);

  if (request.cookies.get(names.access)?.value) return NextResponse.next();

  const refresh = request.cookies.get(names.refresh)?.value;
  if (!refresh) return toLogin(request, surface);

  // Link prefetches must not use up the one-time refresh token (the API treats reuse as theft and ends the session).
  const isPrefetch = request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
  if (isPrefetch) return NextResponse.next();

  let result: RefreshResult | null = null;
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/admin/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: "no-store",
    });
    if (response.ok) result = await response.json();
    else if (response.status !== 401) return NextResponse.next(); // API trouble: do not sign anyone out for it
  } catch {
    return NextResponse.next();
  }
  if (!result) return toLogin(request, surface);

  /* Which token this surface runs on. On /super-admin it is the super-admin one or nothing: an
     account that has lost `admins.manage` gets an admin token back and is signed out here rather
     than left holding a session that every request would refuse. */
  const accessToken = surface === "super" ? result.superAdminAccessToken : result.accessToken;
  if (!accessToken) return toLogin(request, surface);

  // Make the new tokens visible to this request's page render, and store them in the browser.
  request.cookies.set(names.access, accessToken);
  request.cookies.set(names.refresh, result.refreshToken);
  const response = NextResponse.next({ request });
  response.cookies.set(names.access, accessToken, accessCookieOptions(result.expiresInSeconds));
  response.cookies.set(names.refresh, result.refreshToken, refreshCookieOptions);
  return response;
}

/*
 * Both prefixes, whole. The old matchers listed individual sections and missed several —
 * admin's blog, categories, locations, search, seo and homepage, and super-admin's accounts,
 * featured and listings — so on those pages a 15-minute-old session was bounced to the sign-in page
 * instead of being refreshed silently. Matching the prefix means a page added later is covered the
 * day it is added, rather than the day somebody notices it is not.
 */
export const config = { matcher: ["/admin/:path*", "/super-admin/:path*"] };
