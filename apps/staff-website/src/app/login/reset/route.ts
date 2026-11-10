import { NextResponse, type NextRequest } from "next/server";
import { cookiesFor } from "@/lib/session-cookies";

// Reached when the API rejects a saved session. Clears both surfaces' cookies, then shows the
// sign-in page. Both, because this route is shared now and the rejected one is not named in the
// request -- and clearing a session that was already unusable costs nothing.
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  for (const surface of ["admin", "super"] as const) {
    const names = cookiesFor(surface);
    response.cookies.delete(names.access);
    response.cookies.delete(names.refresh);
  }
  return response;
}
