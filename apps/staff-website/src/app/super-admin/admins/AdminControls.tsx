"use client";

import { useActionState, useId, useState } from "react";
import type { AdminRow } from "@/lib/super-admin-api";
import {
  createAdminAction,
  editAdminAction,
  resetPasswordAction,
  revokeSessionsAction,
} from "./account-actions";
import {
  emptyCreateState,
  type CreateAdminState,
  type EditAdminState,
  type ResetPasswordState,
} from "./account-state";

/**
 * The interactive parts of Admin Accounts: the Create modal, the edit and reset forms inside the
 * details panel, and the revoke button.
 *
 * Presented on the original theme's classes — `.modal`, `.card`, `.form-control`, `.btn`,
 * `.alert` — so they look like the rest of Minia. The modal is React's own: Bootstrap's modal
 * JavaScript moves the dialog in the DOM and traps focus by mutating it, which is the one thing a
 * React tree cannot share, so the `.show`/`.modal-backdrop` classes are set here instead and the
 * appearance comes entirely from the stylesheet.
 *
 * One rule runs through all of it. **A password is never shown except once, in the response to the
 * request that set it.** There is no "view password" anywhere, because no password is stored in a
 * form anything could read back — only a hash the API never returns. The temporary password lives
 * in a server-action result for a single render; navigating away loses it, which is exactly right.
 */

function FieldError({ message }: { message?: string }) {
  return message ? (
    <div role="alert" className="invalid-feedback d-block">
      {message}
    </div>
  ) : null;
}

/**
 * The one place a password is ever displayed. It is shown with no way to retrieve it again, and the
 * wording says so, because a super admin who closes this without copying it has to reset again.
 */
function TemporaryPassword({ password, who }: { password: string; who?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="alert alert-warning mt-3 mb-0">
      <h5 className="alert-heading font-size-14">
        <i className="mdi mdi-key-variant me-1" />
        Temporary password{who ? ` for ${who}` : ""} — shown once
      </h5>
      <p className="font-size-12 mb-2">
        Copy it now and give it to them directly. It is not stored anywhere and cannot be shown
        again; they must change it the first time they sign in.
      </p>
      <div className="d-flex flex-wrap align-items-center gap-2">
        <code className="bg-white border rounded px-3 py-2 font-size-14 text-body">{password}</code>
        <button
          type="button"
          className="btn btn-sm btn-light"
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
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <i className="bx bx-plus align-middle me-1" /> Create admin
      </button>

      {open ? (
        <>
          <div
            className="modal fade show d-block"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            // Clicking the backdrop closes it; clicking the panel must not.
            onClick={() => setOpen(false)}
          >
            <div
              className="modal-dialog modal-dialog-centered modal-lg"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title" id={titleId}>
                    Create admin
                  </h5>
                  <button
                    type="button"
                    className="btn-close"
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                  />
                </div>

                {state.temporaryPassword ? (
                  <>
                    <div className="modal-body">
                      <TemporaryPassword password={state.temporaryPassword} who={state.createdName} />
                    </div>
                    <div className="modal-footer">
                      <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
                        Done
                      </button>
                    </div>
                  </>
                ) : (
                  <form action={formAction}>
                    <div className="modal-body">
                      <div className="row g-3">
                        <div className="col-12">
                          <label htmlFor="displayName" className="form-label">
                            Full name
                          </label>
                          <input
                            id="displayName"
                            name="displayName"
                            defaultValue={state.values.displayName}
                            required
                            className={`form-control${state.fieldErrors.displayName ? " is-invalid" : ""}`}
                          />
                          <FieldError message={state.fieldErrors.displayName} />
                        </div>

                        <div className="col-12">
                          <label htmlFor="email" className="form-label">
                            Email address
                          </label>
                          <input
                            id="email"
                            name="email"
                            type="email"
                            defaultValue={state.values.email}
                            required
                            className={`form-control${state.fieldErrors.email ? " is-invalid" : ""}`}
                          />
                          <FieldError message={state.fieldErrors.email} />
                        </div>

                        <div className="col-md-6">
                          <label htmlFor="password" className="form-label">
                            Temporary password
                          </label>
                          <input
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="new-password"
                            required
                            className={`form-control${state.fieldErrors.password ? " is-invalid" : ""}`}
                          />
                          <div className="form-text">At least 12 characters.</div>
                          <FieldError message={state.fieldErrors.password} />
                        </div>

                        <div className="col-md-6">
                          <label htmlFor="confirmPassword" className="form-label">
                            Confirm password
                          </label>
                          <input
                            id="confirmPassword"
                            name="confirmPassword"
                            type="password"
                            autoComplete="new-password"
                            required
                            className={`form-control${state.fieldErrors.confirmPassword ? " is-invalid" : ""}`}
                          />
                          <FieldError message={state.fieldErrors.confirmPassword} />
                        </div>

                        <div className="col-md-6">
                          <label htmlFor="role" className="form-label">
                            Role
                          </label>
                          <select
                            id="role"
                            name="role"
                            defaultValue={state.values.role}
                            className="form-select"
                          >
                            {roleSlugs.includes("admin") ? <option value="admin">Admin</option> : null}
                            {roleSlugs.includes("super_admin") ? (
                              <option value="super_admin">Super Admin</option>
                            ) : null}
                          </select>
                          <FieldError message={state.fieldErrors.role} />
                        </div>

                        <div className="col-12">
                          <p className="text-muted font-size-12 mb-0">
                            They will be asked to change this password the first time they sign in,
                            and to set up an authenticator before they can reach anything.
                          </p>
                        </div>

                        {state.message && Object.keys(state.fieldErrors).length === 0 ? (
                          <div className="col-12">
                            <div role="alert" className="alert alert-danger mb-0">
                              {state.message}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="modal-footer">
                      <button type="button" className="btn btn-light" onClick={() => setOpen(false)}>
                        Cancel
                      </button>
                      <button type="submit" disabled={pending} className="btn btn-primary">
                        {pending ? "Creating..." : "Create admin"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" />
        </>
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
    <form action={formAction}>
      <div className="mb-3">
        <label htmlFor={`name-${account.id}`} className="form-label">
          Full name
        </label>
        <input
          id={`name-${account.id}`}
          name="displayName"
          defaultValue={state.values.displayName}
          required
          className={`form-control${state.fieldErrors.displayName ? " is-invalid" : ""}`}
        />
        <FieldError message={state.fieldErrors.displayName} />
      </div>
      <div className="mb-3">
        <label htmlFor={`email-${account.id}`} className="form-label">
          Email address
        </label>
        <input
          id={`email-${account.id}`}
          name="email"
          type="email"
          defaultValue={state.values.email}
          required
          className={`form-control${state.fieldErrors.email ? " is-invalid" : ""}`}
        />
        <FieldError message={state.fieldErrors.email} />
      </div>
      {state.message ? (
        <div
          role={state.success ? "status" : "alert"}
          className={`alert ${state.success ? "alert-success" : "alert-danger"} py-2 px-3 font-size-13`}
        >
          {state.message}
        </div>
      ) : null}
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving..." : "Save details"}
      </button>
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
    <form action={formAction}>
      <div className="mb-3">
        <label htmlFor={`pw-${account.id}`} className="form-label">
          New temporary password
        </label>
        <input
          id={`pw-${account.id}`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className={`form-control${state.fieldErrors.password ? " is-invalid" : ""}`}
        />
        <div className="form-text">At least 12 characters.</div>
        <FieldError message={state.fieldErrors.password} />
      </div>
      <div className="mb-3">
        <label htmlFor={`pw2-${account.id}`} className="form-label">
          Confirm password
        </label>
        <input
          id={`pw2-${account.id}`}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={`form-control${state.fieldErrors.confirmPassword ? " is-invalid" : ""}`}
        />
        <FieldError message={state.fieldErrors.confirmPassword} />
      </div>
      <p className="text-muted font-size-12">
        Every session for this account ends immediately, and they must choose a new password before
        they can do anything.
      </p>
      {state.message && Object.keys(state.fieldErrors).length === 0 ? (
        <div role="alert" className="alert alert-danger py-2 px-3 font-size-13">
          {state.message}
        </div>
      ) : null}
      <button type="submit" disabled={pending} className="btn btn-danger">
        {pending ? "Resetting..." : "Reset password"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------- revoke sessions
export function RevokeSessionsButton({
  account,
  activeSessions,
}: {
  account: AdminRow;
  activeSessions: number;
}) {
  const [state, setState] = useState<{ message?: string; success?: boolean }>({});
  const [pending, setPending] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={pending || activeSessions === 0}
        className="btn btn-outline-secondary"
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
        <div
          role={state.success ? "status" : "alert"}
          className={`alert ${state.success ? "alert-success" : "alert-danger"} py-2 px-3 mt-2 mb-0 font-size-13`}
        >
          {state.message}
        </div>
      ) : null}
    </>
  );
}
