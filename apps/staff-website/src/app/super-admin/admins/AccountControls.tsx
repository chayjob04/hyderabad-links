"use client";

import { useActionState } from "react";
import { resetMfaAction, setRolesAction, setStatusAction } from "./actions";
import { initialAccountActionState, type AccountActionState } from "./state";

const saveButton =
  "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60";
const plainButton =
  "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-60";
const dangerButton =
  "rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60";

function Outcome({ state }: { state: AccountActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-sm text-red-700">
        {state.error}
      </p>
    );
  }
  if (state.done) {
    return (
      <p role="status" className="mt-2 text-sm text-green-800">
        {state.done}
      </p>
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
      <fieldset>
        <legend className="text-sm font-medium">Roles</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {allRoles.map((role) => (
            <label key={role.slug} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="roles"
                value={role.slug}
                defaultChecked={roles.includes(role.slug)}
                className="h-4 w-4"
              />
              <span>
                {role.name}{" "}
                <span className="text-neutral-500">({role.permissions.length} permissions)</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" disabled={pending} className={`${saveButton} mt-3`}>
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
      className="inline"
      onSubmit={(event) => {
        if (disabling && !window.confirm("Disable this account? They will be signed out straight away.")) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" disabled={pending} className={disabling ? dangerButton : plainButton}>
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
      className="inline"
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
      <button type="submit" disabled={pending} className={plainButton}>
        {pending ? "Clearing..." : "Reset authenticator"}
      </button>
      <Outcome state={state} />
    </form>
  );
}
