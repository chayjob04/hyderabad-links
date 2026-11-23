// Shared by the decision form (client) and its server action, which may only export async
// functions. The same shape the review queue uses, for the same reason: a failed submit must not
// lose what the moderator typed.

export type ChangeDecisionState = {
  /** What the moderator typed, sent back so a failed submit does not lose it. */
  note: string;
  error?: string;
};

export const initialChangeDecisionState: ChangeDecisionState = { note: "" };
