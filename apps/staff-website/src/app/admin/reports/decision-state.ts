// Shared by the report decision form (client) and its server action, which may only export async
// functions.

export type ReportDecisionState = {
  /** What the moderator typed, sent back so a failed submit does not lose it. */
  note: string;
  error?: string;
};

export const initialReportDecisionState: ReportDecisionState = { note: "" };
