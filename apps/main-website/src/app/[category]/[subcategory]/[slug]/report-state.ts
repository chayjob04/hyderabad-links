// Shared by the report form (client) and its server action, which may only export async functions.

export type ReportFormState = {
  /** Sent back so a rejected form keeps what was typed. */
  values: { reason: string; details: string };
  message?: string;
  fieldErrors: Record<string, string>;
  /** True once the API has accepted it; the form is replaced by a thank-you. */
  sent?: boolean;
};

export const emptyReportState: ReportFormState = { values: { reason: "", details: "" }, fieldErrors: {} };

/** True once a favourite action has been taken, so the button can say what happened. */
export type FavouriteState = { saved: boolean; message?: string };
