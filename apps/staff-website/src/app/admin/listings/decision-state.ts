// Shared by the decision form (client) and its server action. Kept out of the "use server" file.

export type DecisionState = {
  error?: string;
  /** Kept so a rejection reason is not lost when the API refuses it (too short, say). */
  reason?: string;
};

export const initialDecisionState: DecisionState = {};
