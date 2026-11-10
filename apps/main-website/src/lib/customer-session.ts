import { cookies } from "next/headers";
import {
  CUSTOMER_ACCESS_COOKIE,
  CUSTOMER_REFRESH_COOKIE,
  customerAccessCookieOptions,
  customerRefreshCookieOptions,
} from "./customer-session-cookies";
import type { SessionTokens } from "./session-cookies";

// Server-side only (uses next/headers). The owner equivalent is session.ts; the two are kept apart
// on purpose, so a page cannot read one session while believing it holds the other.

export async function setCustomerSessionCookies(tokens: SessionTokens): Promise<void> {
  const jar = await cookies();
  jar.set(CUSTOMER_ACCESS_COOKIE, tokens.accessToken, customerAccessCookieOptions(tokens.expiresInSeconds));
  jar.set(CUSTOMER_REFRESH_COOKIE, tokens.refreshToken, customerRefreshCookieOptions);
}

export async function clearCustomerSessionCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(CUSTOMER_ACCESS_COOKIE);
  jar.delete(CUSTOMER_REFRESH_COOKIE);
}

export async function readCustomerTokens(): Promise<{ access: string | null; refresh: string | null }> {
  const jar = await cookies();
  return {
    access: jar.get(CUSTOMER_ACCESS_COOKIE)?.value ?? null,
    refresh: jar.get(CUSTOMER_REFRESH_COOKIE)?.value ?? null,
  };
}

/**
 * Where a customer may be sent after signing in.
 *
 * Wider than the owner rule, and deliberately so: a customer signs in from a business page to save
 * it or review it, and sending them back to that page is the whole point. So any path on this site
 * is allowed — but only a path. A value starting with `//` is a protocol-relative URL to somewhere
 * else, and a backslash is how a browser can be talked into reading one as a host, so both are
 * refused. Nothing with a scheme can get through, because it would not start with a single slash.
 */
export function safeCustomerNextPath(
  value: string | null | undefined,
  fallback: string = "/my/saved",
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
