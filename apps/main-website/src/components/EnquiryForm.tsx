"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field, describedBy, fieldClass } from "@/components/ui/Field";
import { sendEnquiryAction } from "@/app/[category]/[subcategory]/[slug]/actions";
import { emptyEnquiryState } from "@/app/[category]/[subcategory]/[slug]/enquiry-state";

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full cursor-pointer rounded-full bg-brand-700 px-6 py-3 text-base font-extrabold text-white hover:bg-brand-800 disabled:opacity-60"
    >
      {pending ? "Sending..." : "Send enquiry"}
    </button>
  );
}

/**
 * The contact form on a business's public page. Unlike Call and WhatsApp, this leaves the owner a
 * record they can follow up in their dashboard.
 *
 * The sender has no account and never will: these are just the details they chose to give. The
 * action posts through this site's own server, so the browser never calls the API directly.
 */
export function EnquiryForm({ city, locality, slug, businessName }: {
  city: string;
  locality: string;
  slug: string;
  businessName: string;
}) {
  const [state, formAction] = useActionState(sendEnquiryAction, emptyEnquiryState);
  const error = (field: string) => state.fieldErrors[field];

  if (state.sent) {
    return (
      <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-5">
        <p className="font-black text-green-900">Your enquiry has been sent.</p>
        <p className="mt-1 text-sm text-green-800">
          {businessName} can see your message and your number, and will get back to you directly.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="city" value={city} />
      <input type="hidden" name="locality" value={locality} />
      <input type="hidden" name="slug" value={slug} />

      {state.message ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800">
          {state.message}
        </p>
      ) : null}

      <Field id="enq-name" label="Your name" error={error("name")}>
        <input
          id="enq-name"
          name="name"
          defaultValue={state.values.name}
          autoComplete="name"
          required
          aria-invalid={error("name") ? true : undefined}
          aria-describedby={describedBy("enq-name", Boolean(error("name")), false)}
          className={fieldClass}
        />
      </Field>

      <Field id="enq-phone" label="Mobile number" error={error("phone")} help="So they can call or message you back.">
        <input
          id="enq-phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          defaultValue={state.values.phone}
          autoComplete="tel"
          placeholder="98765 43210"
          required
          aria-invalid={error("phone") ? true : undefined}
          aria-describedby={describedBy("enq-phone", Boolean(error("phone")), true)}
          className={fieldClass}
        />
      </Field>

      <Field id="enq-email" label="Email (optional)" error={error("email")}>
        <input
          id="enq-email"
          name="email"
          type="email"
          defaultValue={state.values.email}
          autoComplete="email"
          aria-invalid={error("email") ? true : undefined}
          aria-describedby={describedBy("enq-email", Boolean(error("email")), false)}
          className={fieldClass}
        />
      </Field>

      <Field id="enq-message" label="What do you need?" error={error("message")}>
        <textarea
          id="enq-message"
          name="message"
          rows={4}
          defaultValue={state.values.message}
          required
          minLength={10}
          maxLength={2000}
          aria-invalid={error("message") ? true : undefined}
          aria-describedby={describedBy("enq-message", Boolean(error("message")), false)}
          className={fieldClass}
        />
      </Field>

      <SendButton />
    </form>
  );
}
