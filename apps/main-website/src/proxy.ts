import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, refreshCookieOptions } from "@/lib/session-cookies";
import { API_BASE_URL } from "@/lib/api-base";

// Runs before every /account page. Owner access tokens last 15 minutes: when the access cookie is gone but the
// refresh cookie is still there, swap it for a fresh pair here (the only place that can set cookies before render).
function toLogin(request: NextRequest): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.redirect(url);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}

export async function proxy(request: NextRequest) {
  if (request.cookies.get(ACCESS_COOKIE)?.value) return NextResponse.next();

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh) return toLogin(request);

  // Link prefetches must not use up the one-time refresh token (the API treats reuse as theft and signs everyone out).
  const isPrefetch = request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
  if (isPrefetch) return NextResponse.next();

  let result: { accessToken: string; refreshToken: string; expiresInSeconds: number } | null = null;
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/owner/refresh`, {
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
  if (!result) return toLogin(request);

  // Make the new tokens visible to this request's page render, and store them in the browser.
  request.cookies.set(ACCESS_COOKIE, result.accessToken);
  request.cookies.set(REFRESH_COOKIE, result.refreshToken);
  const response = NextResponse.next({ request });
  response.cookies.set(ACCESS_COOKIE, result.accessToken, accessCookieOptions(result.expiresInSeconds));
  response.cookies.set(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions);
  return response;
}

export const config = { matcher: ["/account/:path*"] };
