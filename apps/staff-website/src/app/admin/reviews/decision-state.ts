// Shared by the review decision form (client) and its server action, which may only export async
// functions.

export type ReviewDecisionState = {
  /** What the moderator typed, sent back so a failed submit does not lose it. */
  note: string;
  error?: string;
};

export const initialReviewDecisionState: ReviewDecisionState = { note: "" };
