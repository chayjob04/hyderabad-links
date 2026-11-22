"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { emptyListingFormState, type ListingFormState } from "@/app/account/form-state";

/**
 * The listing editor's shell: one save, one submit, below all five sections.
 *
 * The two buttons used to sit inside the "Business details" accordion, because that is the one
 * section with a form of its own -- the other four save each item as it is added. That put the only
 * way to submit a listing behind a heading an owner had to open first, and made Save look like it
 * belonged to one section rather than to the whole listing.
 *
 * They are out here now, under everything. The fields stay where they are, inside the section, and
 * the buttons reach them through the HTML that exists for exactly this: the form carries an id and
 * the buttons carry `form="<that id>"`, so a button outside a form still submits it. Nothing is
 * duplicated and no section had to be lifted out of its accordion.
 *
 * <b>Which button was pressed</b> travels in a hidden input rather than in the submitting button's
 * own value. A button outside the form is still the submitter, but whether its name and value reach
 * the action depends on the browser supporting `new FormData(form, submitter)`, and "Submit was
 * quietly treated as Save" is the worst way for that to fail. The hidden input is read the same way
 * everywhere, and if JavaScript never arrives the form still submits as a save.
 */

type EditorContext = {
  /** The id the fields' `<form>` carries, and the id the buttons target. */
  formId: string;
  state: ListingFormState;
  formAction: (formData: FormData) => void;
  /** True while a save is on its way: the buttons are out of use and say what is happening. */
  busy: boolean;
  /** Called by the fields when anything is typed, so leaving the page can warn. */
  markDirty: () => void;
  /**
   * The form's own submit handler: it marks the save as under way and refuses a second one.
   *
   * This is on the form rather than on the buttons, and that is not a detail. Setting the state
   * from a button's click handler disables the button inside the same event, and a disabled
   * button's activation behaviour is skipped -- so the form stopped submitting at all. Measured in
   * Chrome: the request never left. Here the submission has already begun.
   */
  beginSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

const Editor = createContext<EditorContext | null>(null);

/** The fields' side of the editor. Throws rather than rendering a form nothing would submit. */
export function useListingEditor(): EditorContext {
  const context = useContext(Editor);
  if (!context) throw new Error("ListingForm must be rendered inside a ListingEditor.");
  return context;
}

/** What one section still wants, for the summary above the buttons. */
export type SectionOutstanding = {
  /** The `<details>` element's id, so "Open this section" can open it. */
  id: string;
  title: string;
  missing: string[];
  /** True when the API will refuse a submission until these are filled in. */
  blocksReview?: boolean;
};

type Props = {
  /** The bound server action: create when the listing is new, update when it exists. */
  action: (previous: ListingFormState, formData: FormData) => Promise<ListingFormState>;
  initialValues: Record<string, string>;
  /** Which section each field lives in, so a refused submission can open the right one. */
  fieldSections: Record<string, string>;
  outstanding: SectionOutstanding[];
  /** The sections, server-rendered, passed straight through. */
  children: ReactNode;
};

/** The form the action buttons submit. One per screen, so the id is a constant. */
export const DETAILS_FORM_ID = "listing-details-form";

function openSection(id: string): HTMLDetailsElement | null {
  const element = document.getElementById(id);
  if (element instanceof HTMLDetailsElement) {
    element.open = true;
    return element;
  }
  return null;
}

export function ListingEditor({ action, initialValues, fieldSections, outstanding, children }: Props) {
  const [state, formAction, pending] = useActionState(action, {
    ...emptyListingFormState,
    values: initialValues,
  });
  const [dirty, setDirty] = useState(false);
  /* Whether a save is on its way, tracked here rather than taken from `useActionState`.
     Measured in Chrome: with the submitting button outside the form -- which is the whole point of
     this layout -- React dispatches the action (the request carries its `next-action` header) but
     the hook's `pending` stays false for the whole round trip, so the buttons never disabled
     themselves and never said "Saving...". This is set in the click and cleared when the action
     answers, so what the owner sees does not depend on that detail. */
  const [saving, setSaving] = useState(false);
  const lastRev = useRef(state.rev);
  /* Disabling the buttons on `pending` is not enough on its own: two clicks inside the same frame
     both land before React has re-rendered with the new state, and on the add-a-business form that
     is two listings rather than one wasted request. A ref is read and written in the click itself,
     so the second click sees the first. Measured: without it, a double click sent two requests. */
  const inFlight = useRef(false);

  /* A save is the end of the unsaved changes, whatever it answered: either the values are stored or
     the form is showing why they are not, and in both cases a "leave site?" prompt would be about
     work the owner can see on the screen in front of them. */
  useEffect(() => {
    if (state.rev !== lastRev.current) {
      lastRev.current = state.rev;
      setDirty(false);
      setSaving(false);
      inFlight.current = false;
    }
  }, [state.rev]);

  /* A refused submission opens the section the missing field is in and puts the cursor in it. The
     API answers with the field names the form uses, which is what makes this possible without a
     second copy of the rules on this side. */
  useEffect(() => {
    const [firstField] = Object.keys(state.fieldErrors);
    if (state.success || !firstField) return;
    const section = fieldSections[firstField];
    if (section) openSection(section);
    const input = document.getElementById(firstField);
    if (input) {
      input.scrollIntoView({ block: "center", behavior: "smooth" });
      input.focus({ preventScroll: true });
    }
  }, [state.rev, state.success, state.fieldErrors, fieldSections]);

  // Closing the tab, or reloading, with something typed in.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* And leaving by a link, which `beforeunload` never sees because the page is not unloaded. Only
     while something is unsaved, only for plain left clicks on this site's own links, and never for
     a click the browser is about to handle itself (a new tab, a download). */
  useEffect(() => {
    if (!dirty) return;
    const ask = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      if (!link.getAttribute("href")?.startsWith("/")) return;
      if (!window.confirm("You have changes you have not saved yet. Leave this page and lose them?")) {
        event.preventDefault();
      }
    };
    document.addEventListener("click", ask, true);
    return () => document.removeEventListener("click", ask, true);
  }, [dirty]);

  /* Either signal means a save is on its way: the hook's own, in case a future React reports it
     for a submitter outside the form, and the one this component sets, which always does. */
  const busy = saving || pending;

  /**
   * Which button was pressed, written into the form's hidden field. Nothing else happens here, so
   * the click goes on to submit the form -- see `beginSubmit`.
   */
  const press = (intent: "save" | "submit") => {
    const form = document.getElementById(DETAILS_FORM_ID);
    if (!(form instanceof HTMLFormElement)) return;
    const field = form.elements.namedItem("intent");
    if (field instanceof HTMLInputElement) field.value = intent;
  };

  /* One submission at a time. A second click inside the same frame gets here before React has
     re-rendered the buttons as disabled, so the ref is what stops it; the disabled buttons stop
     every later one. A form that fails the browser's own required-field check never submits, so
     this does not run and nothing is left stuck. */
  const beginSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (inFlight.current) {
      event.preventDefault();
      return;
    }
    inFlight.current = true;
    setSaving(true);
  };

  const blocking = outstanding.filter((section) => section.blocksReview && section.missing.length > 0);
  const other = outstanding.filter((section) => !section.blocksReview && section.missing.length > 0);

  return (
    <Editor.Provider
      value={{
        formId: DETAILS_FORM_ID,
        state,
        formAction,
        busy,
        markDirty: () => setDirty(true),
        beginSubmit,
      }}
    >
      {children}

      {/* The action area. Outside every `<details>`, so it is there whichever sections are open. */}
      <div className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_28px_#002a3410] sm:p-6">
        {state.message ? (
          <p
            role={state.success ? "status" : "alert"}
            className={`mb-4 rounded-lg border px-4 py-3 text-sm font-medium ${
              state.success
                ? "border-brand-200 bg-brand-50 text-brand-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {state.message}
          </p>
        ) : null}

        {/* What is still outstanding, and where. The fields the API will refuse a submission over
            are kept apart from the rest: telling an owner a video is "missing" in the same breath
            as the address would make both easy to ignore. */}
        {blocking.length > 0 ? (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-black">Needed before we can review it</p>
            <ul className="mt-1.5 space-y-1">
              {blocking.map((section) => (
                <li key={section.id}>
                  {section.title}: {section.missing.join(", ")}.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      const element = openSection(section.id);
                      element?.scrollIntoView({ block: "start", behavior: "smooth" });
                    }}
                    className="cursor-pointer font-black underline"
                  >
                    Open this section
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {other.length > 0 ? (
          <p className="mb-4 text-sm text-muted">
            Worth adding, though not needed for review:{" "}
            {other.map((section) => section.title.toLowerCase()).join(", ")}.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            form={DETAILS_FORM_ID}
            onClick={() => press("save")}
            disabled={busy}
            className="cursor-pointer rounded-full border border-brand-300 px-7 py-3 text-base font-extrabold text-brand-700 hover:border-brand-700 hover:bg-brand-50 disabled:cursor-default disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save changes"}
          </button>
          <button
            type="submit"
            form={DETAILS_FORM_ID}
            onClick={() => press("submit")}
            disabled={busy}
            className="cursor-pointer rounded-full bg-brand-700 px-7 py-3 text-base font-extrabold text-white hover:bg-brand-800 disabled:cursor-default disabled:opacity-60"
          >
            {busy ? "Sending..." : "Submit for review"}
          </button>
        </div>

        <p className="mt-3 text-sm text-muted">
          Save keeps your work without sending it to us, and leaves a draft a draft. Submit asks us
          to review it.
          {dirty ? (
            <span className="font-bold text-amber-800"> You have changes you have not saved.</span>
          ) : null}
        </p>
      </div>
    </Editor.Provider>
  );
}
