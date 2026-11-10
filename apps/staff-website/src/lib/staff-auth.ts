/**
 * The one staff sign-in, used by the single login page for both tabs.
 *
 * There has only ever been one set of sign-in endpoints — `/api/v1/auth/admin/*` — for both
 * surfaces: the same password, the same authenticator, the same lockout. What differs is which
 * token comes back and which cookie we keep it in.
 *
 * `StaffSession.superAdminAccessToken` is minted by the API only for an account holding
 * `admins.manage`, read live from the database on every sign-in. That one field is the whole role
 * check: the super-admin tab keeps a session when it is present and refuses when it is not, so the
 * tab a person clicked can never grant anything the database did not.
 *
 * These are re-exported from super-admin-api rather than copied, because a second implementation of
 * the sign-in calls is a second place for them to drift.
 */
export {
  confirmEnrollment,
  staffLogin,
  staffLogout,
  startEnrollment,
  verifyMfa,
  type Enrolled,
  type Enrollment,
  type MfaRequired,
  type StaffSession,
} from "./super-admin-api";
