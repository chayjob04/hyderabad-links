"use server";

import { redirect } from "next/navigation";
import type { LoginTab } from "@/components/ui/LoginTabs";
import { requestCustomerOtp, verifyCustomerOtp } from "@/lib/customer-api";
import { safeCustomerNextPath, setCustomerSessionCookies } from "@/lib/customer-session";
import { getMeWithToken, requestOtp, verifyOtp } from "@/lib/owner-api";
import { safeNextPath, setSessionCookies } from "@/lib/session";
import { defaultDestination, type LoginState } from "./state";

/**
 * One form, two entirely separate sign-ins.
 *
 * The tab is not a label on one flow any more: it chooses which authentication runs. The user tab
 * sends a `customer_login` code and opens a session in `customers`; the business tab sends an
 * `owner_login` code and opens one in `users`. Different OTP purpose, different identity table,
 * different token audience, different cookies — a code issued for one cannot open the other, and
 * the API enforces that, not this file.
 *
 * Which is why signing in to save a shop can no longer make somebody a business account by
 * accident, and why the same mobile number may hold both independently.
 */
export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const intent = String(formData.get("intent") ?? "request");
  const phone = String(formData.get("phone") ?? "").trim();
  // Re-read rather than trusted: anything that is not "business" is treated as the user tab.
  const tab: LoginTab = String(formData.get("tab") ?? "") === "business" ? "business" : "user";

  if (intent === "change") return { step: "phone", phone };

  if (intent === "request") {
    if (!phone) return { step: "phone", phone, error: "Enter your 10-digit mobile number." };
    const result = tab === "business" ? await requestOtp(phone) : await requestCustomerOtp(phone);
    if (!result.ok) return { step: "phone", phone, error: result.message };
    return { step: "code", phone, notice: "We sent a 6-digit code by SMS. It is valid for 5 minutes." };
  }

  // intent === "verify"
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { step: "code", phone, error: "Enter the 6-digit code." };

  const next = String(formData.get("next") ?? "");

  if (tab === "business") {
    const result = await verifyOtp(phone, code);
    if (!result.ok) return { step: "code", phone, error: result.message };
    await setSessionCookies(result.data);

    /* Verifying the code also creates the business account, so a first-time number arrives here
       signed in with nothing filled in. /onboarding is where the business itself is registered. */
    const me = await getMeWithToken(result.data.accessToken);
    if (me.ok && me.data.needsOnboarding) redirect("/onboarding");

    redirect(safeNextPath(next, defaultDestination("business")));
  }

  const result = await verifyCustomerOtp(phone, code);
  if (!result.ok) return { step: "code", phone, error: result.message };
  await setCustomerSessionCookies(result.data);

  /* No onboarding, and nothing to register. A customer account is finished the moment it exists;
     the name and email are theirs to fill in later if they want to. */
  redirect(safeCustomerNextPath(next, defaultDestination("user")));
}
