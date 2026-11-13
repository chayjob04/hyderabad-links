"use client";

import { useActionState } from "react";
import { resetMfaAction, setRolesAction, setStatusAction } from "./actions";
import { initialAccountActionState, type AccountActionState } from "./state";

/**
 * Roles, access and authenticator: the three one-click changes that sit beside each row.
 *
 * Restyled onto the original theme's classes — `.form-check`, `.btn`, `.alert` are Bootstrap's and
 * are styled by the Minia stylesheet. The actions, the confirmations and the state they return are
 * untouched; only the markup changed.
 */

function Outcome({ state }: { state: AccountActionState }) {
  if (state.error) {
    return (
      <div role="alert" className="alert alert-danger py-2 px-3 mt-2 mb-0 font-size-13">
        {state.error}
      </div>
    );
  }
  if (state.done) {
    return (
      <div role="status" className="alert alert-success py-2 px-3 mt-2 mb-0 font-size-13">
        {state.done}
      </div>
    );
  }
  return null;
}

/** The roles an account holds, as tick boxes. Submitting replaces the whole set. */
export function RolesForm({
  adminId,
  roles,
  allRoles,
}: {
  adminId: number;
  roles: string[];
  allRoles: { slug: string; name: string; permissions: string[] }[];
}) {
  const [state, formAction, pending] = useActionState(
    setRolesAction.bind(null, adminId),
    initialAccountActionState,
  );

  return (
    <form action={formAction}>
      <fieldset className="border-0 p-0 m-0">
        <legend className="font-size-13 fw-semibold text-muted text-uppercase mb-2">Roles</legend>
        {allRoles.map((role) => (
          <div key={role.slug} className="form-check mb-1">
            <input
              className="form-check-input"
              type="checkbox"
              name="roles"
              value={role.slug}
              id={`role-${adminId}-${role.slug}`}
              defaultChecked={roles.includes(role.slug)}
            />
            <label className="form-check-label font-size-13" htmlFor={`role-${adminId}-${role.slug}`}>
              {role.name}{" "}
              <span className="text-muted">({role.permissions.length} permissions)</span>
            </label>
          </div>
        ))}
      </fieldset>
      <button type="submit" disabled={pending} className="btn btn-sm btn-primary mt-2">
        {pending ? "Saving..." : "Save roles"}
      </button>
      <Outcome state={state} />
    </form>
  );
}

/** Enables or disables one account. Disabling also ends its sessions, which the API does. */
export function StatusForm({ adminId, status }: { adminId: number; status: string }) {
  const disabling = status === "active";
  const [state, formAction, pending] = useActionState<AccountActionState>(
    () => setStatusAction(adminId, disabling ? "disabled" : "active"),
    initialAccountActionState,
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (disabling && !window.confirm("Disable this account? They will be signed out straight away.")) {
          event.preventDefault();
        }
      }}
    >
      <p className="font-size-13 fw-semibold text-muted text-uppercase mb-2">Access</p>
      <button
        type="submit"
        disabled={pending}
        className={`btn btn-sm ${disabling ? "btn-outline-danger" : "btn-outline-secondary"}`}
      >
        {pending ? "Saving..." : disabling ? "Disable account" : "Enable account"}
      </button>
      <Outcome state={state} />
    </form>
  );
}

/** Clears an authenticator enrollment. The password is not touched. */
export function ResetMfaForm({ adminId }: { adminId: number }) {
  const [state, formAction, pending] = useActionState<AccountActionState>(
    () => resetMfaAction(adminId),
    initialAccountActionState,
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Clear this authenticator? They will set up a new one, with new recovery codes, at their next sign-in.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <p className="font-size-13 fw-semibold text-muted text-uppercase mb-2">Authenticator</p>
      <button type="submit" disabled={pending} className="btn btn-sm btn-outline-secondary">
        {pending ? "Clearing..." : "Reset authenticator"}
      </button>
      <Outcome state={state} />
    </form>
  );
}
