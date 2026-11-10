"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { loginAction } from "./actions";
import { initialLoginState, type StaffTab } from "./state";

const inputClass =
  "w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";
const primaryButton =
  "w-full rounded-lg bg-brand-700 px-5 py-2.5 text-base font-semibold text-white hover:bg-brand-900 disabled:opacity-60";

/**
 * Admin sign-in in stages: password, then the mandatory authenticator code. A first-time admin gets
 * the enrollment stage in between, and their recovery codes once, before being let through.
 *
 * The token that links the stages is never in this component. It is in an httpOnly cookie the
 * server action sets, so nothing in the browser can read it.
 */
export function LoginForm({ next, tab }: { next: string; tab: StaffTab }) {
  /* The tab seeds the initial state so the first submit already carries it, and is sent again as a
     hidden field on every stage — the action re-reads it rather than trusting the stage it is in. */
  const [state, formAction, pending] = useActionState(loginAction, { ...initialLoginState, tab });

  // On the code stage the admin can switch to a recovery code instead.
  const [useRecovery, setUseRecovery] = useState(false);

  const error = state.error ? (
    <p role="alert" className="mt-3 text-sm text-red-700">
      {state.error}
    </p>
  ) : null;

  const shell = "rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm";

  if (state.stage === "codes") {
    return (
      <div className={shell}>
        <h2 className="text-lg font-semibold">Save your recovery codes</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Each code signs you in once if you lose your authenticator. They are shown now and never
          again, so store them somewhere safe before continuing.
        </p>
        <ul className="mt-4 grid gap-1.5 rounded-lg bg-neutral-50 p-4 font-mono text-sm sm:grid-cols-2">
          {state.recoveryCodes?.map((code) => <li key={code}>{code}</li>)}
        </ul>
        {/* The action always sets `next` on this stage, so the fallback is belt-and-braces — but it
            has to name a route that exists and belongs to the tab that just enrolled. It used to say
            "/listings", which is now /admin/listings and would 404 for either surface. */}
        <Link
          href={state.next ?? (state.tab === "super" ? "/super-admin/overview" : "/admin")}
          className={`${primaryButton} mt-5 block text-center`}
        >
          I have saved them &mdash; continue
        </Link>
      </div>
    );
  }

  if (state.stage === "enroll") {
    return (
      <form action={formAction} className={shell}>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="intent" value="enroll-confirm" />

        <h2 className="text-lg font-semibold">Set up your authenticator</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Every administrator signs in with a one-time code. Add this account to an authenticator app,
          then enter the code it shows.
        </p>

        <p className="mt-4 text-xs font-semibold tracking-wide text-neutral-500 uppercase">Setup key</p>
        <p className="mt-1 font-mono text-sm break-all">{state.enrollment?.secret}</p>
        <p className="mt-1 text-xs text-neutral-500">
          Type this into your authenticator app, or open{" "}
          <a href={state.enrollment?.otpauthUri} className="font-medium text-brand-700 underline">
            this setup link
          </a>{" "}
          on the device that has it.
        </p>

        <label htmlFor="code" className="mt-5 block text-sm font-medium">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          required
          className={`${inputClass} mt-1`}
        />

        <button type="submit" disabled={pending} className={`${primaryButton} mt-5`}>
          {pending ? "Checking..." : "Confirm and sign in"}
        </button>
        {error}
      </form>
    );
  }

  if (state.stage === "mfa") {
    return (
      <form action={formAction} className={shell}>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="intent" value="verify" />

        <h2 className="text-lg font-semibold">Enter your code</h2>
        <p className="mt-1 text-sm text-neutral-600">
          {useRecovery
            ? "Enter one of the recovery codes you saved when you set up your authenticator."
            : "Open your authenticator app and enter the 6-digit code for Hyderabad Links."}
        </p>

        {useRecovery ? (
          <>
            <label htmlFor="recoveryCode" className="mt-4 block text-sm font-medium">
              Recovery code
            </label>
            <input
              id="recoveryCode"
              name="recoveryCode"
              autoComplete="off"
              autoFocus
              required
              className={`${inputClass} mt-1 font-mono`}
            />
          </>
        ) : (
          <>
            <label htmlFor="code" className="mt-4 block text-sm font-medium">
              6-digit code
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              required
              className={`${inputClass} mt-1`}
            />
          </>
        )}

        <button type="submit" disabled={pending} className={`${primaryButton} mt-5`}>
          {pending ? "Checking..." : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => setUseRecovery((on) => !on)}
          className="mt-3 w-full cursor-pointer text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          {useRecovery ? "Use my authenticator instead" : "Use a recovery code instead"}
        </button>
        {error}
      </form>
    );
  }

  return (
    <form action={formAction} className={shell}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="tab" value={tab} />
      <input type="hidden" name="intent" value="password" />

      <label htmlFor="email" className="block text-sm font-medium">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={state.email}
        autoFocus
        required
        className={`${inputClass} mt-1`}
      />

      <label htmlFor="password" className="mt-4 block text-sm font-medium">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className={`${inputClass} mt-1`}
      />

      <button type="submit" disabled={pending} className={`${primaryButton} mt-5`}>
        {pending ? "Signing in..." : "Continue"}
      </button>
      {error}
    </form>
  );
}
