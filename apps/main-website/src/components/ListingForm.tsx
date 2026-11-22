"use client";

import { useListingEditor } from "@/components/account/ListingEditor";
import { Field, fieldClass } from "@/components/ui/Field";
import type { Category } from "@/lib/types";

type Props = {
  categories: Category[];
  localities?: { slug: string; name: string }[]; // only when creating
  lockedLocalityName?: string; // only when editing
};

/**
 * The business details fields.
 *
 * The form element and the inputs live here, inside their accordion section; the buttons that
 * submit them live at the foot of the editor, in `ListingEditor`, which also owns the action state
 * and reports what the save answered. The two are joined by the form's id -- see the note there.
 *
 * Values and field errors come from the editor rather than from props, so the one server action
 * feeds both the fields and the action area, and there is no second copy of the state to keep in
 * step.
 */
export function ListingForm({ categories, localities, lockedLocalityName }: Props) {
  const { formId, state, formAction, markDirty, beginSubmit } = useListingEditor();
  const v = state.values;
  const e = state.fieldErrors;
  const aria = (field: string) => ({
    "aria-invalid": e[field] ? true : undefined,
    "aria-describedby": e[field] ? `${field}-error` : undefined,
  });

  return (
    // key: after each save the form re-mounts with exactly what the server returned, so typed text is never lost
    <form
      key={state.rev}
      id={formId}
      action={formAction}
      onSubmit={beginSubmit}
      onChange={markDirty}
      className="grid gap-5 rounded-2xl border border-line bg-white p-6 shadow-[0_8px_28px_#002a3410]"
    >
      {/* Save or Submit, set by whichever button was pressed. Read by the server action; "save" is
          the answer that cannot surprise anybody, so it is the one that is here by default. */}
      <input type="hidden" name="intent" defaultValue="save" />

      <Field id="name" label="Business name" error={e.name}>
        <input id="name" name="name" defaultValue={v.name} required maxLength={120} className={fieldClass} {...aria("name")} />
      </Field>

      <Field id="categorySlug" label="What kind of business is it?" error={e.categorySlug}>
        <select
          id="categorySlug"
          name="categorySlug"
          defaultValue={v.categorySlug ?? ""}
          required
          className={fieldClass}
          {...aria("categorySlug")}
        >
          <option value="">Choose a category</option>
          {/* The group label carries the segment when there is one, so the three tiers of the
              taxonomy are all visible in a list that can only show two. */}
          {categories.map((parent) => (
            <optgroup
              key={parent.slug}
              label={parent.segmentName ? `${parent.segmentName} · ${parent.name}` : parent.name}
            >
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
        <Field
          id="localitySlug"
          label="Area"
          help="This sets your page address and cannot be changed later."
          error={e.localitySlug}
        >
          <select
            id="localitySlug"
            name="localitySlug"
            defaultValue={v.localitySlug ?? ""}
            required
            className={fieldClass}
            {...aria("localitySlug")}
          >
            <option value="">Choose the area</option>
            {localities.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        // Editing: the area is fixed, because it is part of the listing's public address.
        <div>
          <p className="text-xs font-black tracking-[0.12em] text-muted uppercase">Area</p>
          <p className="mt-1.5 rounded-lg border border-line bg-brand-50 px-3 py-2.5 text-base font-bold text-ink">
            {lockedLocalityName}
          </p>
          <p className="mt-1.5 text-sm text-muted">The area sets your page address, so it cannot be changed.</p>
        </div>
      )}

      <Field id="addressLine" label="Address" help="Needed before you can submit for review." error={e.addressLine}>
        <input
          id="addressLine"
          name="addressLine"
          defaultValue={v.addressLine}
          maxLength={300}
          autoComplete="street-address"
          className={fieldClass}
          {...aria("addressLine")}
        />
      </Field>

      <Field id="pincode" label="Pincode" error={e.pincode}>
        <input
          id="pincode"
          name="pincode"
          defaultValue={v.pincode}
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
          className={`${fieldClass} sm:max-w-40`}
          {...aria("pincode")}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="phonePrimary"
          label="Phone customers can call"
          help="Leave empty to use the number you signed in with."
          error={e.phonePrimary}
        >
          <input
            id="phonePrimary"
            name="phonePrimary"
            type="tel"
            defaultValue={v.phonePrimary}
            inputMode="numeric"
            className={fieldClass}
            {...aria("phonePrimary")}
          />
        </Field>
        <Field id="phoneWhatsapp" label="WhatsApp number (optional)" error={e.phoneWhatsapp}>
          <input
            id="phoneWhatsapp"
            name="phoneWhatsapp"
            type="tel"
            defaultValue={v.phoneWhatsapp}
            inputMode="numeric"
            className={fieldClass}
            {...aria("phoneWhatsapp")}
          />
        </Field>
      </div>

      <Field id="websiteUrl" label="Website (optional)" error={e.websiteUrl}>
        <input
          id="websiteUrl"
          name="websiteUrl"
          defaultValue={v.websiteUrl}
          inputMode="url"
          maxLength={300}
          placeholder="example.com"
          className={fieldClass}
          {...aria("websiteUrl")}
        />
      </Field>

      <Field
        id="description"
        label="About your business"
        help="At least 20 characters before you submit. What you do, and what makes you a good choice."
        error={e.description}
      >
        <textarea
          id="description"
          name="description"
          defaultValue={v.description}
          rows={5}
          maxLength={2000}
          className={fieldClass}
          {...aria("description")}
        />
      </Field>
    </form>
  );
}
