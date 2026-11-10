// Cookie names and options for both staff sessions. No server-only imports here, so proxy.ts can use it too.
// Staff tokens live only in httpOnly cookies on this site's own origin: browser scripts can never read them.
// The names differ from the public site's (hl_access / hl_refresh) so the two sessions cannot be confused
// even when both sites are open on localhost during development.

/**
 * Which staff surface a request belongs to. The two run in one deployment now, but they are still
 * two sessions: separate cookies, separate tokens, separate audiences in the API.
 *
 * Consolidating the deployment is what made one sign-in page possible — a cookie cannot be shared
 * between two origins, and both sites sat on *.vercel.app, which is a public suffix. It deliberately
 * did **not** merge the sessions: holding an admin session gives you nothing under /super-admin,
 * because the API refuses an admin token there whatever this site believes.
 */
export type StaffSurface = "admin" | "super";

type CookieNames = { access: string; refresh: string; mfa: string };

const NAMES: Record<StaffSurface, CookieNames> = {
  admin: { access: "hl_admin_access", refresh: "hl_admin_refresh", mfa: "hl_admin_mfa" },
  super: { access: "hl_super_access", refresh: "hl_super_refresh", mfa: "hl_super_mfa" },
};

/** The cookie names for one surface. Host-only and httpOnly, exactly as when these were two sites. */
export function cookiesFor(surface: StaffSurface): CookieNames {
  return NAMES[surface];
}

/** Which surface a path belongs to. Everything under /super-admin is the platform surface. */
export function surfaceForPath(pathname: string): StaffSurface {
  return pathname === "/super-admin" || pathname.startsWith("/super-admin/") ? "super" : "admin";
}

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/** The access cookie expires slightly before the token does, so we refresh instead of sending a dead token. */
export function accessCookieOptions(expiresInSeconds: number) {
  return { ...base, maxAge: Math.max(expiresInSeconds - 30, 60) };
}

/** Matches the API's default admin refresh-token lifetime (7 days). The API remains the authority on expiry. */
export const refreshCookieOptions = { ...base, maxAge: 60 * 60 * 24 * 7 };

export type SessionTokens = { accessToken: string; refreshToken: string; expiresInSeconds: number };

/**
 * The half-finished sign-in: the password was accepted, the authenticator code is still to come.
 * It is a credential of its own, so it lives in an httpOnly cookie like the others rather than in
 * form state where a browser script could read it. Short-lived on purpose; the API's own token
 * expires at the same time and is the real authority.
 */
export function mfaCookieOptions(expiresInSeconds: number) {
  return { ...base, maxAge: Math.max(expiresInSeconds, 60) };
}
