// Cookie names and options for the owner session. No server-only imports here, so proxy.ts can use it too.
// Tokens live only in httpOnly cookies on this site's own origin: browser scripts can never read them.

export const ACCESS_COOKIE = "hl_access";
export const REFRESH_COOKIE = "hl_refresh";

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

/**
 * One day, matching the API's refresh-token lifetime, so the cookie and the token it holds
 * expire together. The API remains the authority on expiry.
 */
export const refreshCookieOptions = { ...base, maxAge: 60 * 60 * 24 };

export type SessionTokens = { accessToken: string; refreshToken: string; expiresInSeconds: number };
