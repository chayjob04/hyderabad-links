import { cookies } from "next/headers";
import {
  accessCookieOptions,
  cookiesFor,
  mfaCookieOptions,
  refreshCookieOptions,
  type SessionTokens,
  type StaffSurface,
} from "./session-cookies";

// Server-side only (uses next/headers).
//
// Every function here takes the surface it is acting on. There is no default: an omitted argument
// would silently pick one, and writing an admin token into the super-admin cookie is exactly the
// mistake that must not be possible to make by forgetting something.

export async function setSessionCookies(surface: StaffSurface, tokens: SessionTokens): Promise<void> {
  const names = cookiesFor(surface);
  const jar = await cookies();
  jar.set(names.access, tokens.accessToken, accessCookieOptions(tokens.expiresInSeconds));
  jar.set(names.refresh, tokens.refreshToken, refreshCookieOptions);
}

export async function clearSessionCookies(surface: StaffSurface): Promise<void> {
  const names = cookiesFor(surface);
  const jar = await cookies();
  jar.delete(names.access);
  jar.delete(names.refresh);
}

export async function readTokens(
  surface: StaffSurface,
): Promise<{ access: string | null; refresh: string | null }> {
  const names = cookiesFor(surface);
  const jar = await cookies();
  return {
    access: jar.get(names.access)?.value ?? null,
    refresh: jar.get(names.refresh)?.value ?? null,
  };
}

/**
 * Only send someone back to a page of the surface they signed in to (no open redirects, and no
 * crossing between the two surfaces).
 *
 * The prefix check is what keeps the two apart now that they share an origin: a `next` of
 * /super-admin/audit presented to an admin sign-in is discarded, so the most a tampered link can do
 * is land someone on their own dashboard. Reaching the other surface still needs its own sign-in,
 * and the API would refuse the token anyway.
 */
export function safeNextPath(surface: StaffSurface, value: string | null | undefined): string {
  const prefix = surface === "super" ? "/super-admin" : "/admin";
  if (!value || value.startsWith("//") || value.includes("\\")) return prefix;
  return value === prefix || value.startsWith(`${prefix}/`) ? value : prefix;
}

export async function setMfaCookie(
  surface: StaffSurface,
  token: string,
  expiresInSeconds: number,
): Promise<void> {
  const jar = await cookies();
  jar.set(cookiesFor(surface).mfa, token, mfaCookieOptions(expiresInSeconds));
}

export async function readMfaToken(surface: StaffSurface): Promise<string | null> {
  const jar = await cookies();
  return jar.get(cookiesFor(surface).mfa)?.value ?? null;
}

export async function clearMfaCookie(surface: StaffSurface): Promise<void> {
  const jar = await cookies();
  jar.delete(cookiesFor(surface).mfa);
}
