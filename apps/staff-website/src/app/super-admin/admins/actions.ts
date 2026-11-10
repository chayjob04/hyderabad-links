"use server";

import { revalidatePath } from "next/cache";
import { resetAdminMfa, setAdminRoles, setAdminStatus } from "@/lib/super-admin-api";
import type { AccountActionState } from "./state";

/**
 * Replaces an account's roles with whichever boxes were ticked.
 *
 * The API decides whether this is allowed, including the rule that the last super admin cannot drop
 * their own role. These actions never check that themselves: a server action is just another caller.
 */
export async function setRolesAction(
  adminId: number,
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const roles = formData.getAll("roles").map(String);

  const result = await setAdminRoles(adminId, roles);
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/super-admin/admins");
  return { done: roles.length === 0 ? "Roles cleared." : `Roles saved: ${roles.join(", ")}.` };
}

export async function setStatusAction(
  adminId: number,
  status: "active" | "disabled",
): Promise<AccountActionState> {
  const result = await setAdminStatus(adminId, status);
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/super-admin/admins");
  return { done: status === "active" ? "Account enabled." : "Account disabled and signed out." };
}

/**
 * Clears someone's authenticator so they can set up a new one. Their password is untouched: this
 * removes a factor rather than granting a way in, and the next sign-in walks the setup again.
 */
export async function resetMfaAction(adminId: number): Promise<AccountActionState> {
  const result = await resetAdminMfa(adminId);
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/super-admin/admins");
  return { done: "Authenticator cleared. They will set up a new one at their next sign-in." };
}
