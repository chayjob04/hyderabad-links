"use server";

import { redirect } from "next/navigation";
import { staffLogout } from "@/lib/super-admin-api";
import { clearSessionCookies, readTokens } from "@/lib/session";

/** Ends the session on the API as well, so the refresh token cannot be used again. */
export async function signOutAction(): Promise<void> {
  const { refresh } = await readTokens("super");
  if (refresh) await staffLogout(refresh);
  await clearSessionCookies("super");
  redirect("/login");
}
