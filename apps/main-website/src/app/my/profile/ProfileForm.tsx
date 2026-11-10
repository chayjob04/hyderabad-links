"use client";

import { useActionState } from "react";
import { Field, fieldClass } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { saveCustomerProfileAction, type CustomerProfileState } from "../actions";

/**
 * The customer's own name and email. The mobile number is not here: it is the identity the OTP
 * verified, and changing it would mean verifying a new one.
 */
export function ProfileForm({ name, email }: { name: string; email: string }) {
  const initial: CustomerProfileState = { values: { name, email }, fieldErrors: {} };
  const [state, formAction, pending] = useActionState(saveCustomerProfileAction, initial);

  const error = (field: string) => state.fieldErrors[field];

  return (
    <form action={formAction} className="grid gap-5">
      {state.message ? (
        <p
          role={state.success ? "status" : "alert"}
          className={`rounded-lg px-4 py-3 text-sm font-bold ${
            state.success ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-800"
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <Field id="name" label="Your name" error={error("name")} help="Shown with any review you write.">
        <input
          id="name"
          name="name"
          defaultValue={state.values.name}
          autoComplete="name"
          className={fieldClass}
        />
      </Field>

      <Field id="email" label="Email address" error={error("email")} help="Only used if we need to reach you about your account.">
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={state.values.email}
          autoComplete="email"
          className={fieldClass}
        />
      </Field>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
