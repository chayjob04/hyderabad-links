// Shared by the review form (client) and its server action, which may only export async functions.

export type ReviewFormState = {
  values: { rating: string; body: string };
  message?: string;
  fieldErrors: Record<string, string>;
  /** True once the API has accepted it. It is pending moderation, not published. */
  submitted?: boolean;
};

export const emptyReviewState: ReviewFormState = {
  values: { rating: "", body: "" },
  fieldErrors: {},
};
