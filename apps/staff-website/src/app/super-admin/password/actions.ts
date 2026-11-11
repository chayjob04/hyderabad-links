"use server";

import { changeMyPassword } from "@/lib/super-admin-api";

/**
 * Changing your own password from the super-admin surface. The admin surface has its own copy
 * against its own cookie, because a session holds one audience or the other.
 *
 * Nothing here keeps a password. Both values go straight into the request body and the state that
 * comes back carries only whether it worked.
 */
export type ChangePasswordState = {
  message?: string;
  success?: boolean;
  fieldErrors: Record<string, string>;
};

export const emptyPasswordState: ChangePasswordState = { fieldErrors: {} };

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
