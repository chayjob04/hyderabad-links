// Shared by the password form (client) and its server action. Kept out of the "use server" file.
//
// A "use server" module may only export async functions: everything else it exports becomes a
// server reference rather than the value itself. `emptyPasswordState` lived in actions.ts until
// 2026-11-11, so the client received no initial state, useActionState threw on its first render,
// and the form never hydrated -- the page looked right and no button did anything. Every other
// feature here keeps its initial state in a file like this one for exactly that reason.

export type ChangePasswordState = {
  message?: string;
  success?: boolean;
  fieldErrors: Record<string, string>;
};

export const emptyPasswordState: ChangePasswordState = { fieldErrors: {} };
