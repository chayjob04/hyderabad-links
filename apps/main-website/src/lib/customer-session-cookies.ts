// Cookie names and options for the CUSTOMER session. No server-only imports here, so proxy.ts can
// use it too. Tokens live only in httpOnly cookies on this site's own origin: browser scripts can
// never read them.
//
// Separate names from the owner session (`hl_access` / `hl_refresh`) and not a variant of them, so
// that holding one has no bearing on the other. Both sets are host-only on hyderabadlinks.com, so
// one browser can carry a customer session and a business session at the same time without either
// being able to stand in for the other — the tokens inside carry different audiences and the API
// refuses each on the other's routes.
//
// Keeping the owner names untouched is also what means this change signs nobody out: an owner who
// was signed in before the split still is.

export const CUSTOMER_ACCESS_COOKIE = "hl_cust_access";
export const CUSTOMER_REFRESH_COOKIE = "hl_cust_refresh";

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/** The access cookie expires slightly before the token does, so we refresh instead of sending a dead token. */
export function customerAccessCookieOptions(expiresInSeconds: number) {
  return { ...base, maxAge: Math.max(expiresInSeconds - 30, 60) };
}

/** Matches the API's default refresh-token lifetime (30 days). The API remains the authority on expiry. */
export const customerRefreshCookieOptions = { ...base, maxAge: 60 * 60 * 24 * 30 };
