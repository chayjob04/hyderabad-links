// Shared by the link actions (server) and the add form (client). Kept out of actions.ts, which is
// a "use server" file and may only export async functions: a type or constant exported from there
// arrives as undefined in the browser rather than failing loudly.

export type LinkFormState = {
  rev: number;   // bumped on every submit so the form re-mounts and clears
  message?: string;
  /** Per-field messages from the API's validation problem, keyed by field name. */
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

export const emptyLinkFormState: LinkFormState = { rev: 0 };

/** The link types the API accepts, with the wording the owner sees. */
export const LINK_TYPES = [
  { value: "website", label: "Website" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "other", label: "Other" },
] as const;
