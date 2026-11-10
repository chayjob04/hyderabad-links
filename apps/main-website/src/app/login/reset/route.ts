import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/session-cookies";
import { CUSTOMER_ACCESS_COOKIE, CUSTOMER_REFRESH_COOKIE } from "@/lib/customer-session-cookies";

/**
 * Reached when the API rejects a saved sign-in. Clears that realm's cookies, then shows the login
 * page on the tab that was lost.
 *
 * `?tab=user` is the customer session, anything else the business one. Only one realm's cookies are
 * cleared: somebody holding both must not be signed out of the other because this one expired.
 */
export function GET(request: NextRequest) {
  const customer = request.nextUrl.searchParams.get("tab") === "user";

  const url = new URL("/login", request.url);
  url.searchParams.set("tab", customer ? "user" : "business");

  const response = NextResponse.redirect(url);
  if (customer) {
    response.cookies.delete(CUSTOMER_ACCESS_COOKIE);
    response.cookies.delete(CUSTOMER_REFRESH_COOKIE);
  } else {
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
  }
  return response;
}
