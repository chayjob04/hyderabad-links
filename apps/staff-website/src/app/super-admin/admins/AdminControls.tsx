"use client";

import { useActionState, useId, useState } from "react";
import type { AdminRow } from "@/lib/super-admin-api";
import {
  createAdminAction,
  editAdminAction,
  emptyCreateState,
  resetPasswordAction,
  revokeSessionsAction,
  type CreateAdminState,
  type EditAdminState,
  type ResetPasswordState,
} from "./account-actions";

/**
 * The interactive parts of Admin Accounts: the Create modal, the edit and reset forms inside the
 * details panel, and the revoke button.
 *
 * One rule runs through all of it. **A password is never shown except once, in the response to the
 * request that set it.** There is no "view password" anywhere, because no password is stored in a
 * form anything could read back — only a hash the API never returns. The temporary password lives
 * in a server-action result for a single render; navigating away loses it, which is exactly right.
 */

const input =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";
const label = "block text-xs font-semibold tracking-wide text-neutral-600 uppercase";
const primary =
  "inline-flex items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60";
const quiet =
  "inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-60";

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mt-1 text-xs font-medium text-red-700">
      {message}
    </p>
  ) : null;
}

/**
 * The one place a password is ever displayed. It is shown with no way to retrieve it again, and the
 * wording says so, because a super admin who closes this without copying it has to reset again.
 */
function TemporaryPassword({ password, who }: { password: string; who?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        Temporary password{who ? ` for ${who}` : ""} — shown once
      </p>
      <p className="mt-1 text-xs text-amber-900">
        Copy it now and give it to them directly. It is not stored anywhere and cannot be shown
        again; they must change it the first time they sign in.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded border border-amber-300 bg-white px-3 py-2 font-mono text-sm break-all text-neutral-900">
          {password}
        </code>
        <button
          type="button"
          className={quiet}
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- create
export function CreateAdminButton({ roleSlugs }: { roleSlugs: string[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CreateAdminState, FormData>(
    createAdminAction,
    emptyCreateState,
  );
  const titleId = useId();

  return (
    <>
      <button type="button" className={primary} onClick={() => setOpen(true)}>
        Create admin
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/40 p-4 sm:items-center"
          // Clicking the backdrop closes it; clicking the panel must not.
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id={titleId} className="text-lg font-bold text-neutral-900">
                Create admin
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-neutral-500 hover:bg-neutral-100"
              >
                Close
              </button>
            </div>

            {state.temporaryPassword ? (
              <>
                <TemporaryPassword password={state.temporaryPassword} who={state.createdName} />
                <div className="mt-5 flex justify-end">
                  <button type="button" className={primary} onClick={() => setOpen(false)}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form action={formAction} className="mt-5 grid gap-4">
                <div>
                  <label htmlFor="displayName" className={label}>
                    Full name
                  </label>
                  <input id="displayName" name="displayName" defaultValue={state.values.displayName} required className={`${input} mt-1`} />
                  <FieldError message={state.fieldErrors.displayName} />
                </div>

                <div>
                  <label htmlFor="email" className={label}>
                    Email address
                  </label>
                  <input id="email" name="email" type="email" defaultValue={state.values.email} required className={`${input} mt-1`} />
                  <FieldError message={state.fieldErrors.email} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="password" className={label}>
                      Temporary password
                    </label>
                    <input id="password" name="password" type="password" autoComplete="new-password" required className={`${input} mt-1`} />
                    <p className="mt-1 text-xs text-neutral-500">At least 12 characters.</p>
                    <FieldError message={state.fieldErrors.password} />
                  </div>
                  <div>
                    <label htmlFor="confirmPassword" className={label}>
                      Confirm password
                    </label>
                    <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={`${input} mt-1`} />
                    <FieldError message={state.fieldErrors.confirmPassword} />
                  </div>
                </div>

                <div>
                  <label htmlFor="role" className={label}>
                    Role
                  </label>
                  <select id="role" name="role" defaultValue={state.values.role} className={`${input} mt-1`}>
                    {roleSlugs.includes("admin") ? <option value="admin">Admin</option> : null}
                    {roleSlugs.includes("super_admin") ? <option value="super_admin">Super Admin</option> : null}
                  </select>
                  <FieldError message={state.fieldErrors.role} />
                </div>

                <p className="text-xs text-neutral-500">
                  They will be asked to change this password the first time they sign in, and to set
                  up an authenticator before they can reach anything.
                </p>

                {state.message && Object.keys(state.fieldErrors).length === 0 ? (
                  <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                    {state.message}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button type="button" className={quiet} onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" disabled={pending} className={primary}>
                    {pending ? "Creating..." : "Create admin"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------- edit
export function EditAdminForm({ account }: { account: AdminRow }) {
  const initial: EditAdminState = {
    values: { email: account.email, displayName: account.displayName },
    fieldErrors: {},
  };
  const [state, formAction, pending] = useActionState<EditAdminState, FormData>(
    editAdminAction.bind(null, account.id),
    initial,
  );

  return (
    <form action={formAction} className="grid gap-3">
      <div>
        <label htmlFor={`name-${account.id}`} className={label}>
          Full name
        </label>
        <input id={`name-${account.id}`} name="displayName" defaultValue={state.values.displayName} required className={`${input} mt-1`} />
        <FieldError message={state.fieldErrors.displayName} />
      </div>
      <div>
        <label htmlFor={`email-${account.id}`} className={label}>
          Email address
        </label>
        <input id={`email-${account.id}`} name="email" type="email" defaultValue={state.values.email} required className={`${input} mt-1`} />
        <FieldError message={state.fieldErrors.email} />
      </div>
      {state.message ? (
        <p
          role={state.success ? "status" : "alert"}
          className={`rounded-lg px-3 py-2 text-sm ${state.success ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-800"}`}
        >
          {state.message}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving..." : "Save details"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------- reset a password
export function ResetPasswordForm({ account }: { account: AdminRow }) {
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(
    resetPasswordAction.bind(null, account.id),
    { fieldErrors: {} },
  );

  if (state.temporaryPassword) {
    return <TemporaryPassword password={state.temporaryPassword} who={account.displayName} />;
  }

  return (
    <form action={formAction} className="grid gap-3">
      <div>
        <label htmlFor={`pw-${account.id}`} className={label}>
          New temporary password
        </label>
        <input id={`pw-${account.id}`} name="password" type="password" autoComplete="new-password" required className={`${input} mt-1`} />
        <p className="mt-1 text-xs text-neutral-500">At least 12 characters.</p>
        <FieldError message={state.fieldErrors.password} />
      </div>
      <div>
        <label htmlFor={`pw2-${account.id}`} className={label}>
          Confirm password
        </label>
        <input id={`pw2-${account.id}`} name="confirmPassword" type="password" autoComplete="new-password" required className={`${input} mt-1`} />
        <FieldError message={state.fieldErrors.confirmPassword} />
      </div>
      <p className="text-xs text-neutral-500">
        Every session for this account ends immediately, and they must choose a new password before
        they can do anything.
      </p>
      {state.message && Object.keys(state.fieldErrors).length === 0 ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Resetting..." : "Reset password"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------- revoke sessions
export function RevokeSessionsButton({ account, activeSessions }: { account: AdminRow; activeSessions: number }) {
  const [state, setState] = useState<{ message?: string; success?: boolean }>({});
  const [pending, setPending] = useState(false);

  return (
    <div className="grid gap-2">
      <button
        type="button"
        disabled={pending || activeSessions === 0}
        className={quiet}
        onClick={async () => {
          setPending(true);
          setState(await revokeSessionsAction(account.id));
          setPending(false);
        }}
      >
        {pending
          ? "Ending sessions..."
          : activeSessions === 0
            ? "No sessions to end"
            : `End ${activeSessions} session${activeSessions === 1 ? "" : "s"}`}
      </button>
      {state.message ? (
        <p
          role={state.success ? "status" : "alert"}
          className={`rounded-lg px-3 py-2 text-sm ${state.success ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-800"}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
