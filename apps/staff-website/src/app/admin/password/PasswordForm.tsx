"use client";

import { useActionState } from "react";
import { changePasswordAction } from "./actions";
import { emptyPasswordState, type ChangePasswordState } from "./password-state";

const input =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";
const label = "block text-xs font-semibold tracking-wide text-neutral-600 uppercase";

/**
 * Change your own password. Shared in shape with the admin surface's copy; each posts to the
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
      <div role="status" className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900">
        <p className="font-semibold">{state.message}</p>
        <p className="mt-1">You can carry on in this window.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      {mustChange ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You are on a temporary password. Choose your own before you can do anything else.
        </p>
      ) : null}

      <div>
        <label htmlFor="currentPassword" className={label}>
          Current password
        </label>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className={input} />
        {state.fieldErrors.currentPassword ? (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700">{state.fieldErrors.currentPassword}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="newPassword" className={label}>
          New password
        </label>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required className={input} />
        <p className="mt-1 text-xs text-neutral-500">At least 12 characters.</p>
        {state.fieldErrors.newPassword ? (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700">{state.fieldErrors.newPassword}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="confirmPassword" className={label}>
          Confirm new password
        </label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={input} />
        {state.fieldErrors.confirmPassword ? (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700">{state.fieldErrors.confirmPassword}</p>
        ) : null}
      </div>

      {state.message && Object.keys(state.fieldErrors).length === 0 ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.message}</p>
      ) : null}

      <p className="text-xs text-neutral-500">
        Your other sessions will be signed out. Your authenticator is not affected.
      </p>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "Changing..." : "Change password"}
        </button>
      </div>
    </form>
  );
}
