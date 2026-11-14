"use client";

import { useActionState } from "react";
import { changePasswordAction } from "./actions";
import { emptyPasswordState, type ChangePasswordState } from "./password-state";

/**
 * Change your own password. Shared in shape with the super-admin surface's copy; each posts to the
 * action that holds its own session's cookie.
 *
 * The current password is asked for even though you are already signed in, because being signed in
 * proves the session was opened at some point, not that the person at the keyboard now is the one
 * who opened it.
 */
export function PasswordForm({ mustChange }: { mustChange: boolean }) {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    emptyPasswordState,
  );

  if (state.success) {
    return (
      <div role="status" className="alert alert-success mb-0">
        <h5 className="alert-heading font-size-14">{state.message}</h5>
        <p className="mb-0 font-size-13">You can carry on in this window.</p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      {mustChange ? (
        <div className="alert alert-warning">
          You are on a temporary password. Choose your own before you can do anything else.
        </div>
      ) : null}

      <div className="mb-3">
        <label htmlFor="currentPassword" className="form-label">
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={`form-control${state.fieldErrors.currentPassword ? " is-invalid" : ""}`}
        />
        {state.fieldErrors.currentPassword ? (
          <div role="alert" className="invalid-feedback d-block">
            {state.fieldErrors.currentPassword}
          </div>
        ) : null}
      </div>

      <div className="mb-3">
        <label htmlFor="newPassword" className="form-label">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          className={`form-control${state.fieldErrors.newPassword ? " is-invalid" : ""}`}
        />
        <div className="form-text">At least 12 characters.</div>
        {state.fieldErrors.newPassword ? (
          <div role="alert" className="invalid-feedback d-block">
            {state.fieldErrors.newPassword}
          </div>
        ) : null}
      </div>

      <div className="mb-3">
        <label htmlFor="confirmPassword" className="form-label">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={`form-control${state.fieldErrors.confirmPassword ? " is-invalid" : ""}`}
        />
        {state.fieldErrors.confirmPassword ? (
          <div role="alert" className="invalid-feedback d-block">
            {state.fieldErrors.confirmPassword}
          </div>
        ) : null}
      </div>

      {state.message && Object.keys(state.fieldErrors).length === 0 ? (
        <div role="alert" className="alert alert-danger py-2 px-3 font-size-13">
          {state.message}
        </div>
      ) : null}

      <p className="text-muted font-size-12">
        Your other sessions will be signed out. Your authenticator is not affected.
      </p>

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Changing..." : "Change password"}
      </button>
    </form>
  );
}
