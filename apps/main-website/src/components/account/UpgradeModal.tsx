"use client";

import { useEffect, useId, useRef, useState } from "react";
import { UpgradeButton } from "@/components/account/UpgradeButton";

/**
 * The upgrade prompt behind every locked Verified feature.
 *
 * <b>It does not take a payment.</b> It explains one feature, names the price the API quoted, and
 * then hands over to <see cref="UpgradeButton"/> — the component the Plan and payment screen
 * already uses, which opens the order through our own API and runs Razorpay's own checkout. There
 * is exactly one payment implementation in this project and this is not a second one: if the
 * button's sequence ever changes, every lock in the dashboard changes with it.
 *
 * <b>Why a dialog and not a page.</b> A locked feature is a detour: the owner was trying to add a
 * photo, not shopping for a plan. A dialog explains the one thing they just reached for and gives
 * the page back when they dismiss it. The Plan and payment screen is still there for somebody who
 * wants to read the whole offer, and this links to it.
 *
 * Built on the browser's own `<dialog>`: focus trapping, Escape, the backdrop and `aria-modal` all
 * come with it, which is the argument against hand-rolling one out of a fixed div — and against
 * adding a dialog library for one screen.
 */
export function UpgradeModal({
  listingId,
  priceLabel,
  featureTitle,
  featureBenefit,
  trigger,
  paymentsLive,
}: {
  listingId: number;
  /** Already formatted by the caller from the API's price, e.g. "₹399". Never hardcoded here. */
  priceLabel: string;
  /** The one feature this lock was on, so the dialog answers what the owner just clicked. */
  featureTitle: string;
  /** Why it is worth having, in one sentence. */
  featureBenefit: string;
  /** What opens the dialog. Rendered as-is, so each lock keeps its own shape. */
  trigger: React.ReactNode;
  /**
   * Whether a payment can actually be taken. The API answers 503 for the whole paid path while no
   * provider is configured, and the subscription screen already says so rather than opening a
   * checkout that cannot complete; this says the same thing in the same situation.
   */
  paymentsLive: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  /* showModal() rather than the `open` attribute: only the modal form gets the top layer, the
     backdrop and the focus trap. React cannot express that as a prop, so it is an effect. */
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        /* Clicking the backdrop closes it. The backdrop is the dialog element itself, so the test
           is whether the click landed outside the panel below rather than inside it. */
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-0 text-ink backdrop:bg-brand-800/40"
      >
        <div className="px-6 py-6 sm:px-7">
          <p className="text-[11px] font-black tracking-[0.18em] text-brand-700 uppercase">
            Verified listing
          </p>
          <h2 id={titleId} className="mt-1 text-xl font-black tracking-tight text-brand-800">
            {featureTitle}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{featureBenefit}</p>

          <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
            Everything in the Verified listing, for{" "}
            <span className="text-base font-black text-ink">{priceLabel}</span> a year.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {paymentsLive ? (
              <UpgradeButton listingId={listingId} priceLabel={priceLabel} renewal={false} />
            ) : (
              <p className="text-sm font-bold text-muted">
                Online payment is not switched on yet, so nothing can be charged today.
              </p>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm font-bold text-muted hover:text-ink hover:underline"
            >
              Not now
            </button>
          </div>

          <p className="mt-4 text-xs text-muted">
            Payment is taken by Razorpay. Card and UPI details are entered in their window and never
            reach HYDERABAD LINKS.{" "}
            <a
              href={`/account/listings/${listingId}/subscription`}
              className="font-bold text-brand-700 hover:underline"
            >
              See everything Verified includes
            </a>
          </p>
        </div>
      </dialog>
    </>
  );
}
