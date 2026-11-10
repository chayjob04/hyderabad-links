// Shared by the account forms (client) and their server actions, which may only export async
// functions.

export type AccountActionState = { error?: string; done?: string };

export const initialAccountActionState: AccountActionState = {};
