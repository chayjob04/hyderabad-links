"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmPaymentAction, startPaymentAction } from "@/app/account/listings/[id]/subscription/actions";

/** Razorpay's checkout script, loaded on the first click rather than on every page view. */
const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

type RazorpayResult = {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
};

type RazorpayInstance = { open: () => void };

declare global {
  // Added by the checkout script once it has loaded. Only ever read, never assigned here.
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

function loadCheckout(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Razorpay) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("script failed")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("script failed"));
    document.head.appendChild(script);
  });
}

/**
 * Pays for the Verified plan.
 *
 * The sequence is deliberate. The order is opened by our own API first, so a payment can only ever
 * be made against an order this database already knows about; the checkout then runs in Razorpay's
 * own frame, so no card detail touches this site; and the result it hands back is sent straight to
 * the API, which is the only side holding the key secret and therefore the only side that can decide
 * the payment was real. This component cannot grant anything, which is the point of writing it this
 * way.
 *
 * A customer who closes the tab mid-payment is not lost: Razorpay's webhook reaches the API without
 * a browser, and that path grants the same subscription.
 */
export function UpgradeButton({
  listingId,
  priceLabel,
  renewal,
}: {
  listingId: number;
  priceLabel: string;
  renewal: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setMessage(null);

    const started = await startPaymentAction(listingId);
    if (!started.ok) {
      setBusy(false);
      setMessage(started.message);
      return;
    }

    try {
      await loadCheckout();
    } catch {
      setBusy(false);
      // The order exists and is unpaid, which is harmless: it expires at the provider.
      setMessage("The payment window could not be loaded. Check your connection and try again — nothing has been charged.");
      return;
    }

    const Razorpay = window.Razorpay;
    if (!Razorpay) {
      setBusy(false);
      setMessage("The payment window could not be loaded. Nothing has been charged.");
      return;
    }

    const checkout = new Razorpay({
      key: started.keyId,
      order_id: started.orderId,
      amount: started.amountPaise,
      currency: started.currency,
      name: "HYDERABAD LINKS",
      description: `${started.planName} plan — ${started.businessName}`,
      handler: async (result: RazorpayResult) => {
        const confirmed = await confirmPaymentAction(listingId, {
          razorpayOrderId: result.razorpay_order_id ?? "",
          razorpayPaymentId: result.razorpay_payment_id ?? "",
          razorpaySignature: result.razorpay_signature ?? "",
        });

        setBusy(false);
        if (!confirmed.ok) {
          setMessage(confirmed.message);
          return;
        }

        setDone(
          confirmed.paidUntil
            ? `Payment received. This listing is Verified until ${new Date(confirmed.paidUntil).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`
            : "Payment received.",
        );
        router.refresh();
      },
      modal: {
        // Closing the window is not a failure: no payment was made, and the order simply goes unused.
        ondismiss: () => {
          setBusy(false);
          setMessage("Payment cancelled. Nothing has been charged.");
        },
      },
    });

    checkout.open();
  }

  if (done) {
    return (
      <p role="status" className="rounded-xl bg-brand-50 px-5 py-4 text-sm font-bold text-brand-800">
        {done}
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="cursor-pointer rounded-full bg-brand-700 px-7 py-3 text-sm font-extrabold text-white hover:bg-brand-800 disabled:cursor-default disabled:opacity-60"
      >
        {busy ? "Opening payment..." : renewal ? `Renew for ${priceLabel}` : `Get Verified for ${priceLabel}`}
      </button>

      {message ? (
        <p role="alert" className="mt-3 text-sm font-bold text-red-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}
