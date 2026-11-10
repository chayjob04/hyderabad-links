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
 * The business tab keeps the destination it has always had. The user tab lands on favourites, which
 * is the only part of the account a visitor with no business has a reason to open.
 */
export function defaultDestination(tab: LoginTab): string {
  return tab === "business" ? "/account/listings" : "/account/favourites";
}
