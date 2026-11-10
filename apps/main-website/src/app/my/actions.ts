"use server";

import { redirect } from "next/navigation";
import { logoutCustomerSession, updateCustomerProfile } from "@/lib/customer-api";
import { clearCustomerSessionCookies, readCustomerTokens } from "@/lib/customer-session";

/**
 * Ends the customer session on the API as well, so the refresh token cannot be used again.
 *
 * It touches only the customer cookies. Somebody who is also signed in as a business owner stays
 * signed in there: two accounts, two sessions, and signing out of one is not signing out of the
 * other.
 */
export async function signOutCustomerAction(): Promise<void> {
  const { refresh } = await readCustomerTokens();
  if (refresh) await logoutCustomerSession(refresh);
  await clearCustomerSessionCookies();
  redirect("/");
}

export type CustomerProfileState = {
  values: { name: string; email: string };
  message?: string;
  success?: boolean;
  fieldErrors: Record<string, string>;
};

export async function saveCustomerProfileAction(
  _previous: CustomerProfileState,
  formData: FormData,
): Promise<CustomerProfileState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
  };

  const result = await updateCustomerProfile(values);
  if (!result.ok) {
    return { values, message: result.message, fieldErrors: result.fieldErrors };
  }

  return {
    values: { name: result.data.name, email: result.data.email },
    success: true,
    message: "Your details were saved.",
    fieldErrors: {},
  };
}
