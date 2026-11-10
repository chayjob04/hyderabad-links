"use client";

import { useActionState } from "react";
import { Field, describedBy, fieldClass } from "@/components/ui/Field";
import type { LoginTab } from "@/components/ui/LoginTabs";
import { loginAction } from "./actions";
import { initialLoginState } from "./state";

const primaryButton =
  "w-full cursor-pointer rounded-full bg-brand-700 px-5 py-3 text-base font-extrabold text-white hover:bg-brand-800 disabled:cursor-default disabled:opacity-60";
const linkButton =
  "cursor-pointer font-bold text-brand-700 underline-offset-2 hover:underline disabled:cursor-default disabled:opacity-60";

/** Hides the middle of the number, as the prototype does: 98765 43210 becomes 98****3210. */
function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  return `${phone.slice(0, 2)}${"*".repeat(phone.length - 6)}${phone.slice(-4)}`;
}

export function LoginForm({
  next,
  tab,
  devHint,
}: {
  next: string;
  tab: LoginTab;
  devHint: boolean;
}) {
  const [state, formAction, pending] = useActionState(loginAction, initialLoginState);
  const onCodeStep = state.step === "code";

  return (
    <form action={formAction} className="rounded-2xl border border-line bg-white p-6 shadow-[0_10px_30px_#002a3412]">
      <input type="hidden" name="next" value={next} />
      {/* The tab only decides where the sign-in lands; the action re-checks it, never trusting this. */}
      <input type="hidden" name="tab" value={tab} />

      {onCodeStep ? (
        <>
          <input type="hidden" name="phone" value={state.phone} />
          <p className="text-center text-sm text-muted">
            We sent a 6-digit code to{" "}
            <strong className="font-bold text-ink">+91 {maskPhone(state.phone)}</strong>
          </p>

          <div className="mt-5">
            <Field id="code" label="6-digit code">
              <input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                required
                placeholder="------"
                aria-describedby={describedBy("code", false, false)}
                className={`${fieldClass} text-center text-xl tracking-[0.6em] placeholder:tracking-[0.4em]`}
              />
            </Field>
          </div>

          {devHint ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Local development: no SMS is sent. Look for &quot;login code&quot; in the window running the API.
            </p>
          ) : null}

          <button type="submit" name="intent" value="verify" disabled={pending} className={`${primaryButton} mt-5`}>
            {pending ? "Checking..." : "Verify and sign in"}
          </button>

          <div className="mt-4 flex flex-wrap justify-between gap-4 text-sm">
            <button type="submit" name="intent" value="request" formNoValidate disabled={pending} className={linkButton}>
              Send a new code
            </button>
            <button type="submit" name="intent" value="change" formNoValidate disabled={pending} className={linkButton}>
              Use a different number
            </button>
          </div>
        </>
      ) : (
        <>
          <Field
            id="phone-input"
            label="Mobile number"
            help={
              tab === "business"
                ? "Use the number registered to your business. We will text you a 6-digit code."
                : "We will text you a 6-digit code. Standard rates apply."
            }
          >
            <div className="flex">
              <span className="flex items-center rounded-l-lg border border-r-0 border-line bg-brand-50 px-3.5 text-base font-bold text-brand-800">
                +91
              </span>
              <input
                id="phone-input"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                defaultValue={state.phone}
                placeholder="98765 43210"
                autoFocus
                required
                aria-describedby={describedBy("phone-input", false, true)}
                className={`${fieldClass} rounded-l-none`}
              />
            </div>
          </Field>

          <button type="submit" name="intent" value="request" disabled={pending} className={`${primaryButton} mt-5`}>
            {pending ? "Sending..." : "Send code"}
          </button>
        </>
      )}

      {state.notice && !state.error ? (
        <p role="status" className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          {state.notice}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
