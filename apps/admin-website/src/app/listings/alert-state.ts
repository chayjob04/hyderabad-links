// Shared by the alert form (client) and its server action. Kept out of the "use server" file.

export type AlertState = {
  error?: string;
  sent?: boolean;
  /** Kept so a message is not lost when the API refuses it (too short, say). */
  reason?: string;
  message?: string;
};

export const initialAlertState: AlertState = {};
