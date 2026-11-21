"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field, describedBy, fieldClass } from "@/components/ui/Field";
import type { Category, Locality } from "@/lib/types";
import { onboardAction } from "./actions";
import { emptyOnboardingState } from "./state";

type Props = { phone: string; categories: Category[]; localities: Locality[] };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full cursor-pointer rounded-full bg-brand-700 px-6 py-3 text-base font-extrabold text-white hover:bg-brand-800 disabled:cursor-default disabled:opacity-60"
    >
      {pending ? "Creating your account..." : "Create my free listing"}
    </button>
  );
}

/** Shown once, to an owner who has verified their phone but has not registered yet. */
export function OnboardingForm({ phone, categories, localities }: Props) {
  const [state, formAction] = useActionState(onboardAction, emptyOnboardingState);
  const error = (field: string) => state.fieldErrors[field];

  return (
    // The browser's own `required` checks flag every empty field at once, so nobody fixes one
    // problem only to be shown the next. The server action and the API still validate everything.
    <form action={formAction} className="grid gap-5">
      {state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
        >
          {state.message}
        </p>
      ) : null}

      <Field id="name" label="Your name" error={error("name")}>
        <input
          id="name"
          name="name"
          defaultValue={state.values.name ?? ""}
          autoComplete="name"
          maxLength={100}
          required
          aria-invalid={error("name") ? true : undefined}
          aria-describedby={describedBy("name", !!error("name"), false)}
          className={fieldClass}
        />
      </Field>

      <Field id="businessName" label="Business name" error={error("businessName")}>
        <input
          id="businessName"
          name="businessName"
          defaultValue={state.values.businessName ?? ""}
          autoComplete="organization"
          maxLength={120}
          required
          aria-invalid={error("businessName") ? true : undefined}
          aria-describedby={describedBy("businessName", !!error("businessName"), false)}
          className={fieldClass}
        />
      </Field>

      <Field
        id="email"
        label="Email address"
        error={error("email")}
        help="We use this for enquiries and important updates about your listing."
      >
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={state.values.email ?? ""}
          autoComplete="email"
          maxLength={254}
          required
          aria-invalid={error("email") ? true : undefined}
          aria-describedby={describedBy("email", !!error("email"), true)}
          className={fieldClass}
        />
      </Field>

      <Field
        id="localitySlug"
        label="Area"
        error={error("localitySlug")}
        help="This decides your listing's web address, so it cannot be changed later."
      >
        <select
          id="localitySlug"
          name="localitySlug"
          defaultValue={state.values.localitySlug ?? ""}
          required
          aria-invalid={error("localitySlug") ? true : undefined}
          aria-describedby={describedBy("localitySlug", !!error("localitySlug"), true)}
          className={fieldClass}
        >
          <option value="">Choose your area</option>
          {localities.map((locality) => (
            <option key={locality.slug} value={locality.slug}>
              {locality.name}
            </option>
          ))}
        </select>
      </Field>

      <Field id="categorySlug" label="What your business does" error={error("categorySlug")}>
        <select
          id="categorySlug"
          name="categorySlug"
          defaultValue={state.values.categorySlug ?? ""}
          required
          aria-invalid={error("categorySlug") ? true : undefined}
          aria-describedby={describedBy("categorySlug", !!error("categorySlug"), false)}
          className={fieldClass}
        >
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

      <p className="text-sm text-muted">
        Your listing will be saved as a draft on {phone}. You can add the address, photos and
        description next, then send it for review.
      </p>

      <SubmitButton />
    </form>
  );
}
