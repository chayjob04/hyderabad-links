"use server";

import { changeMyPassword } from "@/lib/admin-api";
import type { ChangePasswordState } from "./password-state";

/**
 * changing your own password from the admin surface. The admin surface has its own copy
 * against its own cookie, because a session holds one audience or the other.
 *
 * Nothing here keeps a password. Both values go straight into the request body and the state that
 * comes back carries only whether it worked.
 *
 * The state type and the initial state are in password-state.ts, because a "use server" file may
 * export nothing but async functions.
 */
export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const result = await changeMyPassword({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });

  if (!result.ok) {
    return { message: result.message, fieldErrors: result.fieldErrors };
  }

  return {
    success: true,
    message: "Your password has been changed. Every other session has been signed out.",
    fieldErrors: {},
  };
}
