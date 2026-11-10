"use server";

import { redirect } from "next/navigation";
import type { LoginTab } from "@/components/ui/LoginTabs";
import { getMeWithToken, requestOtp, verifyOtp } from "@/lib/owner-api";
import { safeNextPath, setSessionCookies } from "@/lib/session";
import { defaultDestination, type LoginState } from "./state";

/** One action for the whole sign-in form. The button that was pressed says what to do (the "intent" field). */
export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const intent = String(formData.get("intent") ?? "request");
  const phone = String(formData.get("phone") ?? "").trim();
  // Re-read rather than trusted: anything that is not "business" is treated as the user tab.
  const tab: LoginTab = String(formData.get("tab") ?? "") === "business" ? "business" : "user";

  if (intent === "change") return { step: "phone", phone };

  if (intent === "request") {
    if (!phone) return { step: "phone", phone, error: "Enter your 10-digit mobile number." };
    const result = await requestOtp(phone);
    if (!result.ok) return { step: "phone", phone, error: result.message };
    return { step: "code", phone, notice: "We sent a 6-digit code by SMS. It is valid for 5 minutes." };
  }

  // intent === "verify"
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { step: "code", phone, error: "Enter the 6-digit code." };
  const result = await verifyOtp(phone, code);
  if (!result.ok) return { step: "code", phone, error: result.message };

  await setSessionCookies(result.data);

  /* Verifying the code also creates the account, so a first-time number arrives here signed in with
     nothing filled in. Only the business tab is sent to register: /onboarding asks for a business
     name and a first listing, which is the wrong question for someone who came to save a favourite.
     A user-tab account keeps `name` null, which the schema allows, until they choose to fill it in. */
  if (tab === "business") {
    const me = await getMeWithToken(result.data.accessToken);
    if (me.ok && me.data.needsOnboarding) redirect("/onboarding");
  }

  redirect(safeNextPath(String(formData.get("next") ?? ""), defaultDestination(tab)));
}
