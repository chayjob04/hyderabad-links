"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { loginAction } from "./actions";
import { initialLoginState, type StaffTab } from "./state";

/**
 * Admin sign-in in stages: password, then the mandatory authenticator code. A first-time admin gets
 * the enrollment stage in between, and their recovery codes once, before being let through.
 *
 * The token that links the stages is never in this component. It is in an httpOnly cookie the
 * server action sets, so nothing in the browser can read it.
 *
 * On the theme's form classes. Not one line of the flow changed with them: the same action, the
 * same four stages, the same hidden `next`/`tab`/`intent` fields re-read by the server on every
 * submit, and the same recovery-code fallback. The original's login had none of this — it was one
 * password box — so there was nothing to copy for the stages beyond the look of the controls.
 */
export function LoginForm({ next, tab }: { next: string; tab: StaffTab }) {
  /* The tab seeds the initial state so the first submit already carries it, and is sent again as a
     hidden field on every stage — the action re-reads it rather than trusting the stage it is in. */
  const [state, formAction, pending] = useActionState(loginAction, { ...initialLoginState, tab });

  // On the code stage the admin can switch to a recovery code instead.
  const [useRecovery, setUseRecovery] = useState(false);

  const error = state.error ? (
    <div role="alert" className="alert alert-danger py-2 px-3 mt-3 mb-0 font-size-13">
      {state.error}
    </div>
  ) : null;

  if (state.stage === "codes") {
    return (
      <div>
        <h5 className="font-size-15 mb-1">Save your recovery codes</h5>
        <p className="text-muted font-size-13">
          Each code signs you in once if you lose your authenticator. They are shown now and never
          again, so store them somewhere safe before continuing.
        </p>
        <div className="border rounded p-3 mb-3">
          <div className="row g-1">
            {state.recoveryCodes?.map((code) => (
              <div key={code} className="col-6">
                <code className="text-body">{code}</code>
              </div>
            ))}
          </div>
        </div>
        {/* The action always sets `next` on this stage, so the fallback is belt-and-braces — but it
            has to name a route that exists and belongs to the tab that just enrolled. */}
        <Link
          href={state.next ?? (state.tab === "super" ? "/super-admin/overview" : "/admin")}
          className="btn btn-primary w-100"
        >
          I have saved them &mdash; continue
        </Link>
      </div>
    );
  }

  if (state.stage === "enroll") {
    return (
      <form action={formAction}>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="intent" value="enroll-confirm" />

        <h5 className="font-size-15 mb-1">Set up your authenticator</h5>
        <p className="text-muted font-size-13">
          Every administrator signs in with a one-time code. Add this account to an authenticator
          app, then enter the code it shows.
        </p>

        <div className="border rounded p-3 mb-3">
          <p className="text-muted font-size-12 text-uppercase mb-1">Setup key</p>
          <code className="text-body text-break">{state.enrollment?.secret}</code>
          <p className="text-muted font-size-12 mt-2 mb-0">
            Type this into your authenticator app, or open{" "}
            <a href={state.enrollment?.otpauthUri}>this setup link</a> on the device that has it.
          </p>
        </div>

        <div className="mb-3">
          <label htmlFor="code" className="form-label">
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
            className="form-control"
          />
        </div>

        <button type="submit" disabled={pending} className="btn btn-primary w-100">
          {pending ? "Checking..." : "Confirm and sign in"}
        </button>
        {error}
      </form>
    );
  }

  if (state.stage === "mfa") {
    return (
      <form action={formAction}>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="intent" value="verify" />

        <h5 className="font-size-15 mb-1">Enter your code</h5>
        <p className="text-muted font-size-13">
          {useRecovery
            ? "Enter one of the recovery codes you saved when you set up your authenticator."
            : "Open your authenticator app and enter the 6-digit code for Hyderabad Links."}
        </p>

        {useRecovery ? (
          <div className="mb-3">
            <label htmlFor="recoveryCode" className="form-label">
              Recovery code
            </label>
            <input
              id="recoveryCode"
              name="recoveryCode"
              autoComplete="off"
              autoFocus
              required
              className="form-control"
            />
          </div>
        ) : (
          <div className="mb-3">
            <label htmlFor="code" className="form-label">
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
              className="form-control"
            />
          </div>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary w-100">
          {pending ? "Checking..." : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => setUseRecovery((on) => !on)}
          className="btn btn-link w-100 mt-2 font-size-13"
        >
          {useRecovery ? "Use my authenticator instead" : "Use a recovery code instead"}
        </button>
        {error}
      </form>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="tab" value={tab} />
      <input type="hidden" name="intent" value="password" />

      <div className="mb-3">
        <label htmlFor="email" className="form-label">
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
          className="form-control"
        />
      </div>

      <div className="mb-3">
        <label htmlFor="password" className="form-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="form-control"
        />
      </div>

      <button type="submit" disabled={pending} className="btn btn-primary w-100">
        {pending ? "Signing in..." : "Continue"}
      </button>
      {error}
    </form>
  );
}
