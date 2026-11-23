"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  changeSubscriptionPlan,
  extendSubscription,
  grantSubscription,
  revokeSubscription,
} from "@/lib/super-admin-api";
import { revalidatePublicPages, reviewPages } from "@/lib/revalidate";

/**
 * Granting, extending, moving and ending a subscription by hand (S0033).
 *
 * None of these checks a permission: the API checks `plans.manage` through the super gate on every
 * call, locks the listing so two admins cannot act on it at once, validates the plan and the period,
 * refuses to end a paid one, and writes the audit entry. A server action is just another caller.
 *
 * Each one redirects back with a short message, the way the categories screen does, so the page
 * stays server-rendered and the fresh figures are the redirect's own render.
 */
const DONE = "/super-admin/subscriptions?done=";
const FAILED = "/super-admin/subscriptions?error=";

function back(result: { ok: boolean; message?: string }, done: string): never {
  revalidatePath("/super-admin/subscriptions");
  redirect(
    result.ok
      ? DONE + encodeURIComponent(done)
      : FAILED + encodeURIComponent(result.message ?? "That did not work."),
  );
}

/**
 * The listing's own public page, refreshed when what it may show changes.
 *
 * A Verified period turns on the badge, the photos and the named links, so a grant or a revocation
 * changes the page a visitor sees. The path is composed from the listing's own slugs rather than
 * derived here -- see pagesAffectedBy, which exists because deriving one by hand produced dead
 * paths everywhere it was tried.
 */
async function refresh(url: string | null): Promise<void> {
  if (url) {
    await revalidatePublicPages(reviewPages(url));
  }
}

const months = (formData: FormData) => Number.parseInt(String(formData.get("months") ?? ""), 10);
const text = (formData: FormData, field: string) => String(formData.get(field) ?? "").trim();

export async function grantAction(
  listingId: number,
  listingUrl: string | null,
  formData: FormData,
): Promise<void> {
  const reason = text(formData, "reason");
  if (reason === "") redirect(FAILED + encodeURIComponent("Say why this is being granted."));

  const result = await grantSubscription(listingId, {
    planSlug: text(formData, "planSlug"),
    months: Number.isSafeInteger(months(formData)) ? months(formData) : 0,
    reason,
  });
  if (result.ok) await refresh(listingUrl);
  back(result, "Granted. No payment was recorded, because none was taken.");
}

export async function extendAction(
  listingId: number,
  listingUrl: string | null,
  formData: FormData,
): Promise<void> {
  const reason = text(formData, "reason");
  if (reason === "") redirect(FAILED + encodeURIComponent("Say why this is being extended."));

  const result = await extendSubscription(listingId, {
    months: Number.isSafeInteger(months(formData)) ? months(formData) : 0,
    reason,
  });
  if (result.ok) await refresh(listingUrl);
  back(result, "Extended. No payment was recorded, because none was taken.");
}

export async function changePlanAction(
  listingId: number,
  listingUrl: string | null,
  formData: FormData,
): Promise<void> {
  const reason = text(formData, "reason");
  if (reason === "") redirect(FAILED + encodeURIComponent("Say why the plan is changing."));

  const result = await changeSubscriptionPlan(listingId, {
    planSlug: text(formData, "planSlug"),
    reason,
  });
  if (result.ok) await refresh(listingUrl);
  back(result, "Moved to the other plan.");
}

/**
 * Ends a complimentary period now.
 *
 * The API refuses this for a period somebody paid for, and says why: that would be a refund, and
 * refunds are a Razorpay operation. Nothing is deleted either way -- the subscription is cancelled
 * and its dates stay, so the record of what was granted survives.
 */
export async function revokeAction(
  listingId: number,
  listingUrl: string | null,
  formData: FormData,
): Promise<void> {
  const reason = text(formData, "reason");
  if (reason === "") redirect(FAILED + encodeURIComponent("Say why this is being ended."));

  const result = await revokeSubscription(listingId, { reason });
  if (result.ok) await refresh(listingUrl);
  back(result, "Ended. The listing reads as Free from now on; nothing was deleted.");
}
