// Shared by the enquiry form (client) and its server action, which may only export async functions.

export type EnquiryFormState = {
  /** Sent back so a rejected form keeps what was typed. */
  values: { name: string; phone: string; email: string; message: string };
  message?: string;
  fieldErrors: Record<string, string>;
  /** True once the API has accepted it; the form is replaced by a confirmation. */
  sent?: boolean;
};

export const emptyEnquiryState: EnquiryFormState = {
  values: { name: "", phone: "", email: "", message: "" },
  fieldErrors: {},
};
