"use client";

import { useActionState } from "react";
import { addLinkAction } from "@/app/account/listings/[id]/links/actions";
import { emptyLinkFormState, LINK_TYPES, type LinkFormState } from "@/app/account/listings/[id]/links/form-state";
import { Field } from "@/components/ui/Field";

const input =
  "w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm font-medium text-ink outline-none focus:border-brand-700";

/**
 * Adds one website or social link.
 *
 * The form is keyed on `state.rev`, which the action bumps on every submit, so a successful add
 * re-mounts it and the fields clear. Without that the owner's last entry stays on screen looking
 * like it has not been saved.
 */
export function AddLinkForm({ listingId, disabled }: { listingId: number; disabled?: boolean }) {
  const [state, formAction, pending] = useActionState<LinkFormState, FormData>(
    (previous, formData) => addLinkAction(listingId, previous, formData),
    emptyLinkFormState,
  );

  return (
    <form key={state.rev} action={formAction} className="mt-4 grid gap-4 sm:grid-cols-[10rem_1fr]">
      <Field id="linkType" label="Type">
        <select id="linkType" name="linkType" defaultValue="website" disabled={disabled} className={input}>
          {LINK_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </Field>

      <Field id="label" label="Label" error={state.fieldErrors?.label} help="What the button will say, e.g. “Our Instagram”.">
        <input
          id="label"
          name="label"
          maxLength={80}
          disabled={disabled}
          aria-invalid={state.fieldErrors?.label ? true : undefined}
          aria-describedby={state.fieldErrors?.label ? "label-error" : undefined}
          className={input}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field id="url" label="Web address" error={state.fieldErrors?.url} help="Must start with http:// or https://">
          <input
            id="url"
            name="url"
            type="url"
            inputMode="url"
            placeholder="https://"
            disabled={disabled}
            aria-invalid={state.fieldErrors?.url ? true : undefined}
            aria-describedby={state.fieldErrors?.url ? "url-error" : undefined}
            className={input}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending || disabled}
          className="cursor-pointer rounded-full bg-brand-700 px-6 py-3 text-sm font-extrabold text-white hover:bg-brand-800 disabled:cursor-default disabled:opacity-60"
        >
          {pending ? "Adding..." : "Add link"}
        </button>

        {/* One banner for anything that is not a field problem — most importantly the plan refusing
            another link, which is not a mistake the owner made and should not look like one. */}
        {state.message && !state.fieldErrors ? (
          <p
            role={state.success ? undefined : "alert"}
            className={`mt-3 text-sm font-bold ${state.success ? "text-brand-700" : "text-red-700"}`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
