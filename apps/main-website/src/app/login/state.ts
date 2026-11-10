// Shared by the login form (client) and its server action. Kept out of the "use server" file.

import type { LoginTab } from "@/components/ui/LoginTabs";

export type LoginState = {
  step: "phone" | "code";
  phone: string;
  error?: string;
  notice?: string;
};

export const initialLoginState: LoginState = { step: "phone", phone: "" };

/**
 * Where a sign-in ends, when the person did not ask for somewhere in particular.
 *
 * The business tab keeps the destination it has always had: the dashboard they came to work in.
 * The user tab lands on the public home page, because someone who signed in to save a place or
 * leave a review came to browse the directory, not to sit in an account screen. Their account is
 * one click away in the header menu.
 */
export function defaultDestination(tab: LoginTab): string {
  return tab === "business" ? "/account/listings" : "/";
}
