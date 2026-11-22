"use client";

import { useId, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import "./confirm-dialog.css";

/**
 * A submit button that asks first.
 *
 * Every destructive control on the staff site was a bare `<button type="submit">` inside a
 * `<form action={someServerAction}>`: one click, gone. The server-side rules are the real
 * safeguard -- the API refuses to delete a listing that has ever been paid for, or a category
 * something still points at -- but a rule that refuses the wrong deletions does nothing about the
 * right one performed by accident, and "Delete" sits a few pixels from "Switch off".
 *
 * <b>Why a button and not a page.</b> These pages are server components, and the forms hand a
 * server action straight to `action={}`. Only the button needs to be interactive, so only the
 * button is a client component; the pages stay exactly as they were. Dropping one of these in
 * place of a `<button type="submit">` is the whole integration.
 *
 * <b>Why a native `<dialog>`.</b> It brings its own backdrop, traps focus inside itself, closes on
 * Escape and returns focus to the button that opened it. Each of those is a thing a hand-rolled
 * modal gets wrong, and the theme's own modal markup would need Bootstrap's JavaScript, which this
 * site does not load.
 *
 * <b>What happens with no JavaScript.</b> The trigger is a real `type="submit"` and the dialog is
 * opened by cancelling that submit. So if the script never arrives the click submits the form, as
 * it does today -- the confirmation is lost, but the control still works. The alternative, a
 * `type="button"` that only JavaScript can submit, would turn all twelve of these into dead
 * controls in that case, which is the failure this component exists to make impossible.
 */

/** Delete is red and permanent; archive is reversible and should not look the same. */
export type ConfirmTone = "delete" | "archive";

type Props = {
  /** The button as it appears on the page. */
  label: string;
  /** The question the dialog asks, e.g. "Delete this category?". */
  title: string;
  /** What will happen if they go ahead. One or two sentences. */
  children: ReactNode;
  /** The record being acted on, so the dialog names it instead of saying "this item". */
  subject?: string | null;
  /** The button that goes ahead. Name the act: "Delete category", not "OK". */
  confirmLabel: string;
  tone?: ConfirmTone;
  /** Classes for the page button, so each call site keeps the appearance it had. */
  className?: string;
};

export function ConfirmButton({
  label,
  title,
  children,
  subject,
  confirmLabel,
  tone = "delete",
  className = "btn btn-sm btn-outline-danger",
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  /* The enclosing form's status. Both buttons go disabled while the action runs, which is what
     stops a second click sending the request twice. */
  const { pending } = useFormStatus();

  return (
    <>
      <button
        type="submit"
        className={className}
        disabled={pending}
        onClick={(event) => {
          // Cancel the submit this button would otherwise perform, and ask instead.
          event.preventDefault();
          dialog.current?.showModal();
        }}
      >
        {label}
      </button>

      <dialog
        ref={dialog}
        className="hl-confirm"
        aria-labelledby={titleId}
        onCancel={(event) => {
          // Escape must not abandon a request that is already in flight.
          if (pending) event.preventDefault();
        }}
      >
        <div className="hl-confirm__body">
          <h2 className="hl-confirm__title" id={titleId}>
            {title}
          </h2>
          <p className="hl-confirm__text">{children}</p>
          {subject ? <span className="hl-confirm__subject">{subject}</span> : null}
        </div>

        <div className="hl-confirm__actions">
          {/* type="button" on purpose: inside a form, a default-type button submits it. */}
          <button
            type="button"
            className="btn btn-light"
            disabled={pending}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          {/* This one does submit the enclosing form, which is how the server action runs. The
              browser focuses Cancel first, because it is first in the source. */}
          <button
            type="submit"
            className={`btn ${tone === "archive" ? "btn-warning" : "btn-danger"}`}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
