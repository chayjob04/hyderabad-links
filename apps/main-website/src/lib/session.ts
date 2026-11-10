import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, refreshCookieOptions, type SessionTokens } from "./session-cookies";

// Server-side only (uses next/headers).

export async function setSessionCookies(tokens: SessionTokens): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, tokens.accessToken, accessCookieOptions(tokens.expiresInSeconds));
  jar.set(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions);
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function readTokens(): Promise<{ access: string | null; refresh: string | null }> {
  const jar = await cookies();
  return { access: jar.get(ACCESS_COOKIE)?.value ?? null, refresh: jar.get(REFRESH_COOKIE)?.value ?? null };
}

/**
 * Only allow sending someone back to a page inside /account after login (no open redirects).
 *
 * The fallback is a parameter because the two login tabs end in different places — a user tab
 * sign-in lands on favourites, a business one on the listings dashboard. It is only ever a
 * destination we chose ourselves; the untrusted `value` is still held to the same rule it always
 * was, so a caller cannot widen what counts as safe by passing a different fallback.
 */
export function safeNextPath(
  value: string | null | undefined,
  fallback: string = "/account/listings",
): string {
  if (!value || !value.startsWith("/account") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
