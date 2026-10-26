"use server";

import { revalidatePath } from "next/cache";
import { confirmSubscriptionPayment, startSubscriptionPayment } from "@/lib/owner-api";

export type StartPaymentState =
  | { ok: true; orderId: string; amountPaise: number; currency: string; keyId: string; planName: string; businessName: string }
  | { ok: false; message: string };

/**
 * Opens an order at the payment provider for this listing.
 *
 * It goes through the API rather than being called from the browser, because opening an order needs
 * the key secret and the browser must never hold it. What comes back is only what the checkout
 * needs: the order id, the amount, and the publishable key.
 */
export async function startPaymentAction(listingId: number): Promise<StartPaymentState> {
  const result = await startSubscriptionPayment(listingId);
  if (!result.ok) {
    // The API's own wording: it is the side that knows whether payments are configured at all, and
    // its 503 already says "nothing has been charged", which is the part an owner needs to read.
    return { ok: false, message: result.message };
  }

  return { ok: true, ...result.data };
}

export type ConfirmPaymentState =
  | { ok: true; paidUntil: string | null; alreadyApplied: boolean }
  | { ok: false; message: string };

/**
 * Hands the checkout's signed result back to the API.
 *
 * Nothing here decides anything about the payment. The signature can only be checked against the
 * key secret, which lives on the API, and the API is also what writes the subscription — so a
 * browser that lies about having paid gets a refusal, not a plan.
 */
export async function confirmPaymentAction(
  listingId: number,
  result: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
): Promise<ConfirmPaymentState> {
  const confirmed = await confirmSubscriptionPayment(listingId, result);
  if (!confirmed.ok) {
    return { ok: false, message: confirmed.message };
  }

  // The badge, the media allowance and the links allowance all change with this, and they are
  // rendered on three different screens.
  revalidatePath(`/account/listings/${listingId}/subscription`);
  revalidatePath(`/account/listings/${listingId}/links`);
  revalidatePath(`/account/listings/${listingId}/photos`);
  revalidatePath("/account/listings");

  return { ok: true, paidUntil: confirmed.data.paidUntil, alreadyApplied: confirmed.data.alreadyApplied };
}
