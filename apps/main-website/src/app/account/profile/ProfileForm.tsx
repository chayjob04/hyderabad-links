"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Field, describedBy, fieldClass } from "@/components/ui/Field";
import { saveProfileAction } from "./actions";
import { initialProfileState } from "./form-state";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save details"}
    </Button>
  );
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, formAction] = useActionState(saveProfileAction, initialProfileState(name, email));
  const error = (field: string) => state.fieldErrors[field];

  return (
    <form key={state.rev} action={formAction} className="grid max-w-xl gap-5">
      {/* Only failures land here; a successful save redirects and the page shows the confirmation. */}
      {state.message ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800">
          {state.message}
        </p>
      ) : null}

      <Field id="name" label="Your name" error={error("name")} help="Shown to our team, not on your public listing.">
        <input
          id="name"
          name="name"
          defaultValue={state.values.name}
          autoComplete="name"
          maxLength={100}
          required
          aria-invalid={error("name") ? true : undefined}
          aria-describedby={describedBy("name", Boolean(error("name")), true)}
          className={fieldClass}
        />
      </Field>

      <Field
        id="email"
        label="Email address"
        error={error("email")}
        help="How we reach you about your listings. Not shown publicly."
      >
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={state.values.email}
          autoComplete="email"
          maxLength={254}
          required
          aria-invalid={error("email") ? true : undefined}
          aria-describedby={describedBy("email", Boolean(error("email")), true)}
          className={fieldClass}
        />
      </Field>

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
