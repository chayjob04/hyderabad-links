"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field, describedBy, fieldClass } from "@/components/ui/Field";
import { SearchableSelect } from "@/components/account/SearchableSelect";
import { SUPPORT_EMAIL } from "@/lib/brand";
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
        <SearchableSelect
          id="localitySlug"
          name="localitySlug"
          options={localities.map((locality) => ({ value: locality.slug, label: locality.name }))}
          defaultValue={state.values.localitySlug ?? ""}
          placeholder="Start typing your area"
          otherLabel="My area is not listed"
          otherName="localityOther"
          otherPlaceholder="The name of your area"
          otherDefaultValue={state.values.localityOther ?? ""}
          invalid={!!error("localitySlug")}
          describedBy={describedBy("localitySlug", !!error("localitySlug"), true)}
        />
      </Field>

      <Field id="categorySlug" label="What your business does" error={error("categorySlug")}>
        <SearchableSelect
          id="categorySlug"
          name="categorySlug"
          /* Flattened, with the path above it as the hint: the groups a `<select>` showed cannot
             be typed into, and carrying the parent along means typing "food" still finds the
             trades under it. The segment is included when the category has one (S0030), so the
             hint reads "in Food - Restaurants and Food" and typing a segment name finds everything
             under it. */
          options={categories.flatMap((parent) =>
            parent.children.map((child) => ({
              value: child.slug,
              label: child.name,
              hint: parent.segmentName ? `in ${parent.segmentName} · ${parent.name}` : `in ${parent.name}`,
            })),
          )}
          defaultValue={state.values.categorySlug ?? ""}
          placeholder="Start typing what you do"
          otherLabel="My category is not listed"
          otherName="categoryOther"
          otherPlaceholder="What your business does"
          otherDefaultValue={state.values.categoryOther ?? ""}
          invalid={!!error("categorySlug")}
          describedBy={describedBy("categorySlug", !!error("categorySlug"), false)}
        />
      </Field>

      {/* Nothing was created from "not in the list", so the request has to leave by a door that
          exists. One click, with the name already in the message. */}
      {state.values.localityOther || state.values.categoryOther ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Please add an area or category")}&body=${encodeURIComponent(
              [
                state.values.localityOther ? `Area: ${state.values.localityOther}` : null,
                state.values.categoryOther ? `Category: ${state.values.categoryOther}` : null,
                state.values.businessName ? `Business: ${state.values.businessName}` : null,
                phone ? `Mobile: ${phone}` : null,
              ]
                .filter(Boolean)
                .join("\n"),
            )}`}
            className="font-black underline"
          >
            Send us the name
          </a>{" "}
          and we will add it, usually within a working day. Pick the nearest option above so you can
          finish signing up now.
        </p>
      ) : null}

      <p className="text-sm text-muted">
        Your listing will be saved as a draft on {phone}. You can add the address, photos and
        description next, then send it for review.
      </p>

      <SubmitButton />
    </form>
  );
}
