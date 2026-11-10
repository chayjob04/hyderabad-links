"use server";

import { redirect } from "next/navigation";
import { actionReport, dismissReport } from "@/lib/admin-api";
import type { ReportDecisionState } from "./decision-state";

/**
 * Closes one report, either as actioned or as dismissed.
 *
 * Closing a report never changes the listing or the review it is about: suspending a listing and
 * rejecting a review are separate, audited actions with their own permission checks. This only
 * records what the moderator concluded.
 */
export async function decideReportAction(
  reportId: number,
  _previous: ReportDecisionState,
  formData: FormData,
): Promise<ReportDecisionState> {
  const note = String(formData.get("note") ?? "");
  const actioned = formData.get("intent") === "action";

  const result = actioned ? await actionReport(reportId, note) : await dismissReport(reportId, note);
  if (!result.ok) {
    return {
      note,
      error:
        result.status === 404
          ? "That report has already been closed by someone else."
          : Object.values(result.fieldErrors)[0] ?? result.message,
    };
  }

  redirect(`/admin/reports?decided=${actioned ? "actioned" : "dismissed"}`);
}
