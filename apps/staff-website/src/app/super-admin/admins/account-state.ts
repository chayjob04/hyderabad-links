// Shared by the Admin Accounts forms (client) and their server actions. Kept out of the
// "use server" file.
//
// A "use server" module may only export async functions: everything else it exports becomes a
// server reference rather than the value itself. `emptyCreateState` lived in account-actions.ts
// until 2026-11-11, so the client received no initial state, useActionState threw on its first
// render, and nothing in AdminControls hydrated -- the Create admin button opened no modal at all,
// because the page's HTML was server-rendered and its JavaScript was not running.
//
// The state types travel with it. A type is erased at compile time and could have stayed, but
// keeping the pair together is what makes the rule visible to the next person.

export type CreateAdminState = {
  values: { email: string; displayName: string; role: string };
  message?: string;
  fieldErrors: Record<string, string>;
  /** Shown once, immediately after creation. */
  temporaryPassword?: string;
  createdName?: string;
};

export const emptyCreateState: CreateAdminState = {
  values: { email: "", displayName: "", role: "admin" },
  fieldErrors: {},
};

export type EditAdminState = {
  values: { email: string; displayName: string };
  message?: string;
  success?: boolean;
  fieldErrors: Record<string, string>;
};

export type ResetPasswordState = {
  message?: string;
  fieldErrors: Record<string, string>;
  /** Shown once, immediately after the reset. */
  temporaryPassword?: string;
};

export type RevokeState = { message?: string; success?: boolean };
