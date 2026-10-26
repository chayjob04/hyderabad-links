// Shared by the listing form (client) and its server actions. Kept out of the "use server" file,
// which may only export async functions.

export type ListingFormState = {
  /** Bumped on every submit so the form re-mounts with exactly what the server sent back. */
  rev: number;
  values: Record<string, string>;
  message?: string;
  success?: boolean;
  fieldErrors: Record<string, string>;
};

export const emptyListingFormState: ListingFormState = { rev: 0, values: {}, fieldErrors: {} };

export type AlertState = {
  error?: string;
  sent?: boolean;
  /** Kept so a message is not lost when the API refuses it (too short, say). */
  reason?: string;
  message?: string;
};

export const initialAlertState: AlertState = {};
