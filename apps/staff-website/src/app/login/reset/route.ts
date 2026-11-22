import { NextResponse, type NextRequest } from "next/server";
import { cookiesFor, type StaffSurface } from "@/lib/session-cookies";

/**
 * Reached when the API rejects a saved session. Clears that surface's cookies, then shows the
 * sign-in page on the tab that was lost.
 *
 * <b>Only one surface's cookies.</b> This used to clear both, which was harmless while a sign-in
 * produced one surface's cookies and no more. A super-admin sign-in now keeps the admin session as
 * well -- that is what makes the admin screens reachable from the super panel -- so clearing both
 * would mean a single rejected request on one surface signed the platform owner out of the other.
 * The public site's own reset route has always worked this way, for the same reason: somebody
 * holding two sessions must not lose the one that is still good.
 *
 * `?surface=super` is the platform surface; anything else is the admin one.
 */
export function GET(request: NextRequest) {
  const surface: StaffSurface = request.nextUrl.searchParams.get("surface") === "super" ? "super" : "admin";

  const url = new URL("/login", request.url);
  url.searchParams.set("tab", surface === "super" ? "super" : "admin");

  const response = NextResponse.redirect(url);
  const names = cookiesFor(surface);
  response.cookies.delete(names.access);
  response.cookies.delete(names.refresh);
  // The half-finished sign-in is this surface's too, and a stale one would resume a dead attempt.
  response.cookies.delete(names.mfa);
  return response;
}
