// Shared by the sign-in form (client) and its server action. Kept out of the "use server" file.

/**
 * Which surface the person is signing in to. It chooses the words, the destination and the cookie —
 * never the permission. See lib/staff-auth.ts.
 */
export type StaffTab = "admin" | "super";

export function readStaffTab(value: string | null | undefined): StaffTab {
  return value === "super" ? "super" : "admin";
}

/**
 * Where the sign-in has got to. The password is only the first stage: MFA is mandatory, so a
 * correct password moves to "mfa", or to "enroll" when the admin has no authenticator yet.
 * "codes" is the one-time showing of the recovery codes, immediately after enrolling.
 *
 * The token for the second stage is deliberately *not* here. It is a credential, so it lives in an
 * httpOnly cookie that no browser script can read.
 */
export type LoginStage = "password" | "mfa" | "enroll" | "codes";

export type LoginState = {
  stage: LoginStage;
  /** Which tab this attempt belongs to, so the later stages keep using the same surface. */
  tab: StaffTab;
  /** Kept so the field is not cleared when the password was wrong. The password is never kept. */
  email: string;
  error?: string;
  /** Set on the "enroll" stage: what the authenticator app needs. */
  enrollment?: { secret: string; otpauthUri: string };
  /** Set on the "codes" stage. Shown once and never retrievable again. */
  recoveryCodes?: string[];
  /** Where to go once the codes have been written down. */
  next?: string;
};

export const initialLoginState: LoginState = { stage: "password", tab: "admin", email: "" };
