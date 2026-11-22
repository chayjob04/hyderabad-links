"use server";

import { redirect } from "next/navigation";
import {
  confirmEnrollment,
  staffLogin,
  startEnrollment,
  verifyMfa,
  type StaffSession,
} from "@/lib/staff-auth";
import {
  clearMfaCookie,
  readMfaToken,
  safeNextPath,
  setMfaCookie,
  setSessionCookies,
} from "@/lib/session";
import { readStaffTab, type LoginState, type StaffTab } from "./state";

/**
 * The whole staff sign-in, in stages, for both tabs. Which stage runs is decided by the "intent"
 * field, the same way the public site's OTP form works.
 *
 * The password alone never produces a session: the API returns a token for the second stage, which
 * is kept in an httpOnly cookie and spent on one of the MFA endpoints. Only those issue the real
 * access and refresh tokens.
 *
 * The tab decides which cookie the finished session is written to, and nothing else. What it cannot
 * do is grant anything — see keepSession below.
 */
export async function loginAction(previous: LoginState, formData: FormData): Promise<LoginState> {
  const intent = String(formData.get("intent") ?? "password");
  const next = String(formData.get("next") ?? "");
  // Re-read from the form on every stage rather than trusted from `previous`, and narrowed to the
  // two known values, so an edited field cannot name a third surface.
  const tab = readStaffTab(String(formData.get("tab") ?? ""));

  if (intent === "password") {
    return await submitPassword(formData, tab, next);
  }

  // Every later stage needs the token the password stage put in this surface's cookie.
  const mfaToken = await readMfaToken(tab);
  if (!mfaToken) {
    return { stage: "password", tab, email: previous.email, error: "That took too long. Please sign in again." };
  }

  if (intent === "enroll-confirm") {
    return await confirmEnrollmentStage(previous, formData, tab, mfaToken, next);
  }

  return await verifyStage(previous, formData, tab, mfaToken, next);
}

const NO_ACCESS =
  "That account does not have platform administration access. Use the Admin login tab instead.";

/**
 * Where the tab is checked against the real role.
 *
 * `superAdminAccessToken` is issued by the API only to an account holding `admins.manage`, read
 * from the database at the moment of sign-in — never from the token, and never from anything this
 * site sent. So the super-admin tab keeps a session only when the API actually handed one over, and
 * an ordinary administrator who picks that tab is refused here rather than being shown a dashboard
 * whose every request would then come back 403.
 *
 * The admin tab keeps the admin token. It is never given the super-admin one, even for an account
 * that holds both: choosing a tab signs you in to that surface only, which keeps a stolen cookie
 * worth exactly what it was worth when these were two sites.
 */
async function keepSession(surface: StaffTab, session: StaffSession): Promise<string | null> {
  if (surface === "super") {
    if (!session.superAdminAccessToken) {
      await clearMfaCookie(surface);
      return NO_ACCESS;
    }

    await setSessionCookies(surface, {
      accessToken: session.superAdminAccessToken,
      refreshToken: session.refreshToken,
      expiresInSeconds: session.expiresInSeconds,
    });

    /*
     * The admin session as well, for a super admin only.
     *
     * Several screens a platform owner needs -- SEO, the blog, categories, areas, search tuning,
     * the homepage strips -- are served by `/api/v1/admin/...` and so live under /admin on this
     * site. With only the super cookies set, every one of those sidebar rows had to be rendered
     * inert, because following it would hit the middleware with no admin cookie and bounce the
     * owner to the admin sign-in. From the inside that reads as being logged out at random, so the
     * rows carried an "Admin" badge instead and the features were simply unreachable.
     *
     * This grants no permission the account does not already hold: the API issued
     * `superAdminAccessToken` only after reading `admins.manage` from the database, and the same
     * sign-in handed back `accessToken` for the same account, whose admin-surface permissions the
     * API checks again on every request. What changes is reachability, not authority.
     *
     * The reverse is deliberately not done. The admin tab below is never given the super token,
     * even for an account that holds both, so choosing a tab still decides what a stolen cookie is
     * worth -- an admin session cannot reach /super-admin.
     */
    await setSessionCookies("admin", session);
  } else {
    await setSessionCookies(surface, session);
  }

  await clearMfaCookie(surface);
  return null;
}

async function submitPassword(formData: FormData, tab: StaffTab, next: string): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { stage: "password", tab, email, error: "Enter your email address and password." };
  }

  const result = await staffLogin(email, password);
  if (!result.ok) {
    return { stage: "password", tab, email, error: result.message };
  }

  await setMfaCookie(tab, result.data.mfaToken, result.data.expiresInSeconds);

  if (result.data.stage === "mfa") {
    return { stage: "mfa", tab, email };
  }

  // No authenticator yet: fetch the secret so it can be added, then ask for the first code.
  const enrollment = await startEnrollment(result.data.mfaToken);
  if (!enrollment.ok) {
    await clearMfaCookie(tab);
    return { stage: "password", tab, email, error: enrollment.message };
  }

  return { stage: "enroll", tab, email, enrollment: enrollment.data };
}

async function confirmEnrollmentStage(
  previous: LoginState,
  formData: FormData,
  tab: StaffTab,
  mfaToken: string,
  next: string,
): Promise<LoginState> {
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) {
    return { ...previous, stage: "enroll", tab, error: "Enter the 6-digit code from your authenticator." };
  }

  const result = await confirmEnrollment(mfaToken, code);
  if (!result.ok) {
    return { ...previous, stage: "enroll", tab, error: result.message };
  }

  // Enrolling signs the admin in as well, so the session starts here.
  const refusal = await keepSession(tab, result.data);
  if (refusal) {
    return { stage: "password", tab, email: previous.email, error: refusal };
  }

  // The codes are shown once, so the redirect waits until they have been written down.
  return {
    stage: "codes",
    tab,
    email: previous.email,
    recoveryCodes: result.data.recoveryCodes,
    next: safeNextPath(tab, next),
  };
}

async function verifyStage(
  previous: LoginState,
  formData: FormData,
  tab: StaffTab,
  mfaToken: string,
  next: string,
): Promise<LoginState> {
  const recoveryCode = String(formData.get("recoveryCode") ?? "").trim();
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");

  if (!recoveryCode && !/^\d{6}$/.test(code)) {
    return { stage: "mfa", tab, email: previous.email, error: "Enter the 6-digit code from your authenticator." };
  }

  const result = await verifyMfa(mfaToken, recoveryCode ? { recoveryCode } : { code });
  if (!result.ok) {
    return { stage: "mfa", tab, email: previous.email, error: result.message };
  }

  const refusal = await keepSession(tab, result.data);
  if (refusal) {
    return { stage: "password", tab, email: previous.email, error: refusal };
  }

  redirect(safeNextPath(tab, next));
}
