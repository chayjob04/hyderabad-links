"use client";

import { useActionState } from "react";
import { emptyListingFormState, type ListingFormState } from "@/app/super-admin/listings/form-state";
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

/**
 * One field: label, control, and either a hint or the error that replaced it.
 *
 * On the theme's form classes. The error uses Bootstrap's `invalid-feedback` with `d-block`,
 * because the control is marked invalid through `aria-invalid` rather than `.is-invalid` — the
 * accessible attribute is the one that matters, and Bootstrap's sibling selector would not fire
 * from it on its own.
 */
function Field(props: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label htmlFor={props.id} className="form-label">
        {props.label}
      </label>
      {props.children}
      {props.hint && !props.error ? <div className="form-text">{props.hint}</div> : null}
      {props.error ? (
        <div id={`${props.id}-error`} className="invalid-feedback d-block">
          {props.error}
        </div>
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
  const control = (field: string) => `form-control${e[field] ? " is-invalid" : ""}`;
  const select = (field: string) => `form-select${e[field] ? " is-invalid" : ""}`;

  return (
    <form key={state.rev} action={formAction}>
      {state.message ? (
        <div
          role={state.success ? "status" : "alert"}
          className={`alert ${state.success ? "alert-success" : "alert-danger"}`}
        >
          {state.message}
        </div>
      ) : null}

      <Field id="name" label="Business name" error={e.name}>
        <input id="name" name="name" defaultValue={v.name} required maxLength={120} className={control("name")} {...aria("name")} />
      </Field>

      <Field id="categorySlug" label="Category" error={e.categorySlug}>
        <select id="categorySlug" name="categorySlug" defaultValue={v.categorySlug ?? ""} required className={select("categorySlug")} {...aria("categorySlug")}>
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
          <select id="localitySlug" name="localitySlug" defaultValue={v.localitySlug ?? ""} required className={select("localitySlug")} {...aria("localitySlug")}>
            <option value="">Choose the area</option>
            {localities.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div className="mb-3">
          <p className="form-label mb-1">Area</p>
          <p className="mb-1">{lockedLocalityName}</p>
          <div className="form-text">
            The area is part of the public address, so it cannot be changed.
          </div>
        </div>
      )}

      <Field id="addressLine" label="Address" error={e.addressLine}>
        <input id="addressLine" name="addressLine" defaultValue={v.addressLine} maxLength={300} className={control("addressLine")} {...aria("addressLine")} />
      </Field>

      <div className="row">
        <div className="col-sm-4">
          <Field id="pincode" label="Pincode" error={e.pincode}>
            <input id="pincode" name="pincode" defaultValue={v.pincode} inputMode="numeric" maxLength={6} className={control("pincode")} {...aria("pincode")} />
          </Field>
        </div>
      </div>

      <div className="row">
        <div className="col-sm-6">
          <Field id="phonePrimary" label="Phone number customers can call" error={e.phonePrimary}>
            <input id="phonePrimary" name="phonePrimary" type="tel" defaultValue={v.phonePrimary} inputMode="numeric" required className={control("phonePrimary")} {...aria("phonePrimary")} />
          </Field>
        </div>
        <div className="col-sm-6">
          <Field id="phoneWhatsapp" label="WhatsApp number (optional)" error={e.phoneWhatsapp}>
            <input id="phoneWhatsapp" name="phoneWhatsapp" type="tel" defaultValue={v.phoneWhatsapp} inputMode="numeric" className={control("phoneWhatsapp")} {...aria("phoneWhatsapp")} />
          </Field>
        </div>
      </div>

      <Field id="websiteUrl" label="Website (optional)" error={e.websiteUrl}>
        <input id="websiteUrl" name="websiteUrl" defaultValue={v.websiteUrl} inputMode="url" placeholder="example.com" className={control("websiteUrl")} {...aria("websiteUrl")} />
      </Field>

      <Field id="description" label="About the business" hint="What they do, in a sentence or two." error={e.description}>
        <textarea id="description" name="description" defaultValue={v.description} rows={5} maxLength={2000} className={control("description")} {...aria("description")} />
      </Field>

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
