// Shared by the listing form (client) and its server actions. Kept out of the "use server" file,
// which may only export async functions.

export type ListingFormState = {
  rev: number; // bumped on every submit so the form re-mounts with the values we send back
  values: Record<string, string>;
  message?: string;
  success?: boolean;
  fieldErrors: Record<string, string>;
};

export const emptyListingFormState: ListingFormState = { rev: 0, values: {}, fieldErrors: {} };

