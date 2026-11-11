"use server";

import { revalidatePath } from "next/cache";
import {
  createAdmin,
  editAdmin,
  resetAdminPassword,
  revokeAdminSessions,
} from "@/lib/super-admin-api";
import type {
  CreateAdminState,
  EditAdminState,
  ResetPasswordState,
  RevokeState,
} from "./account-state";

/**
 * The Admin Accounts actions that are new with S0028: create, edit, reset a password and end
 * sessions. Roles, status and reset-MFA are in actions.ts, unchanged.
 *
 * A temporary password is returned by the API once and carried back to the screen in this state
 * object, which lives for one render. It is never written to a cookie, a log or the audit trail —
 * the super admin reads it, passes it on, and it is gone on the next navigation.
 *
 * The state types and the initial state are in account-state.ts, because a "use server" file may
 * export nothing but async functions.
 */

export async function createAdminAction(
  _previous: CreateAdminState,
  formData: FormData,
): Promise<CreateAdminState> {
  const values = {
    email: String(formData.get("email") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim(),
    role: String(formData.get("role") ?? "admin"),
  };
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const result = await createAdmin({ ...values, password, confirmPassword });
  if (!result.ok) {
    return { values, message: result.message, fieldErrors: result.fieldErrors };
  }

  revalidatePath("/super-admin/admins");
  return {
    values: { email: "", displayName: "", role: "admin" },
    fieldErrors: {},
    temporaryPassword: result.data.temporaryPassword,
    createdName: values.displayName,
  };
}

export async function editAdminAction(
  adminId: number,
  _previous: EditAdminState,
  formData: FormData,
): Promise<EditAdminState> {
  const values = {
    email: String(formData.get("email") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim(),
  };

  const result = await editAdmin(adminId, values);
  if (!result.ok) {
    return { values, message: result.message, fieldErrors: result.fieldErrors };
  }

  revalidatePath("/super-admin/admins");
  return { values, success: true, message: "Details saved.", fieldErrors: {} };
}

export async function resetPasswordAction(
  adminId: number,
  _previous: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const result = await resetAdminPassword(adminId, { password, confirmPassword });
  if (!result.ok) {
    return { message: result.message, fieldErrors: result.fieldErrors };
  }

  revalidatePath("/super-admin/admins");
  return { fieldErrors: {}, temporaryPassword: result.data.temporaryPassword };
}

export async function revokeSessionsAction(adminId: number): Promise<RevokeState> {
  const result = await revokeAdminSessions(adminId);
  if (!result.ok) {
    return { message: result.message };
  }
  revalidatePath("/super-admin/admins");
  return { success: true, message: "Every session for that account has been ended." };
}
