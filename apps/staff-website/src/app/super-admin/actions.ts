"use server";

import { redirect } from "next/navigation";
import { staffLogout } from "@/lib/super-admin-api";
import { clearSessionCookies, readTokens } from "@/lib/session";

/**
 * Ends the session on the API as well, so the refresh token cannot be used again.
 *
 * The redirect names the tab, because the sign-in page defaults to Admin: without it, signing out
 * of platform administration dropped you on the wrong tab and the next sign-in would quietly have
 * been an admin one.
 */
export async function signOutAction(): Promise<void> {
  const { refresh } = await readTokens("super");
  if (refresh) await staffLogout(refresh);
  await clearSessionCookies("super");
  redirect("/login?tab=super");
}
