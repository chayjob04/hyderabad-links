"use client";

import { useActionState } from "react";
import { emptyListingFormState, type ListingFormState } from "@/app/listings/form-state";
import type { Category, Locality } from "@/lib/super-admin-api";

type Props = {
  action: (previous: ListingFormState, formData: FormData) => Promise<ListingFormState>;
  categories: Category[];
  /** Only when adding: the area is part of the public URL and cannot be changed afterwards. */
  localities?: Locality[];
  lockedLocalityName?: string;
  initialValues: Record<string, string>;
  submitLabel: string;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100 aria-[invalid=true]:border-red-600";

function Field(props: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={props.id} className="block text-sm font-medium">
        {props.label}
      </label>
      {props.children}
      {props.hint && !props.error ? <p className="mt-1 text-sm text-neutral-500">{props.hint}</p> : null}
      {props.error ? (
        <p id={`${props.id}-error`} className="mt-1 text-sm text-red-700">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

/** The admin version of the owner's listing form: same fields, but the phone number is always required. */
export function ListingForm({ action, categories, localities, lockedLocalityName, initialValues, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, { ...emptyListingFormState, values: initialValues });
  const v = state.values;
  const e = state.fieldErrors;
  const aria = (field: string) => ({
    "aria-invalid": e[field] ? true : undefined,
    "aria-describedby": e[field] ? `${field}-error` : undefined,
  });

  return (
    <form key={state.rev} action={formAction} className="grid gap-5">
      {state.message ? (
        <p
          role={state.success ? "status" : "alert"}
          className={`rounded-lg px-4 py-3 text-sm ${state.success ? "bg-green-50 text-green-900" : "bg-red-50 text-red-800"}`}
        >
          {state.message}
        </p>
      ) : null}

      <Field id="name" label="Business name" error={e.name}>
        <input id="name" name="name" defaultValue={v.name} required maxLength={120} className={inputClass} {...aria("name")} />
      </Field>

      <Field id="categorySlug" label="Category" error={e.categorySlug}>
        <select id="categorySlug" name="categorySlug" defaultValue={v.categorySlug ?? ""} required className={inputClass} {...aria("categorySlug")}>
          <option value="">Choose a category</option>
          {categories.map((parent) => (
            <optgroup key={parent.slug} label={parent.name}>
              {parent.children.map((child) => (
                <option key={child.slug} value={child.slug}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>

      {localities ? (
        <Field id="localitySlug" label="Area" hint="This sets the page address and cannot be changed later." error={e.localitySlug}>
          <select id="localitySlug" name="localitySlug" defaultValue={v.localitySlug ?? ""} required className={inputClass} {...aria("localitySlug")}>
            <option value="">Choose the area</option>
            {localities.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div>
          <p className="text-sm font-medium">Area</p>
          <p className="mt-1 text-base">{lockedLocalityName}</p>
          <p className="mt-1 text-sm text-neutral-500">The area is part of the public address, so it cannot be changed.</p>
        </div>
      )}

      <Field id="addressLine" label="Address" error={e.addressLine}>
        <input id="addressLine" name="addressLine" defaultValue={v.addressLine} maxLength={300} className={inputClass} {...aria("addressLine")} />
      </Field>

      <Field id="pincode" label="Pincode" error={e.pincode}>
        <input id="pincode" name="pincode" defaultValue={v.pincode} inputMode="numeric" maxLength={6} className={`${inputClass} sm:max-w-40`} {...aria("pincode")} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="phonePrimary" label="Phone number customers can call" error={e.phonePrimary}>
          <input id="phonePrimary" name="phonePrimary" type="tel" defaultValue={v.phonePrimary} inputMode="numeric" required className={inputClass} {...aria("phonePrimary")} />
        </Field>
        <Field id="phoneWhatsapp" label="WhatsApp number (optional)" error={e.phoneWhatsapp}>
          <input id="phoneWhatsapp" name="phoneWhatsapp" type="tel" defaultValue={v.phoneWhatsapp} inputMode="numeric" className={inputClass} {...aria("phoneWhatsapp")} />
        </Field>
      </div>

      <Field id="websiteUrl" label="Website (optional)" error={e.websiteUrl}>
        <input id="websiteUrl" name="websiteUrl" defaultValue={v.websiteUrl} inputMode="url" placeholder="example.com" className={inputClass} {...aria("websiteUrl")} />
      </Field>

      <Field id="description" label="About the business" hint="What they do, in a sentence or two." error={e.description}>
        <textarea id="description" name="description" defaultValue={v.description} rows={5} maxLength={2000} className={inputClass} {...aria("description")} />
      </Field>

      <div>
        <button type="submit" disabled={pending} className="rounded-lg bg-brand-700 px-6 py-2.5 text-base font-semibold text-white hover:bg-brand-900 disabled:opacity-60">
          {pending ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
