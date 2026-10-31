"use server";

import { revalidatePath } from "next/cache";
import { saveOpeningHours, type OpeningInterval } from "@/lib/owner-api";

export type HoursState = { error?: string; saved?: boolean };

/**
 * Saves the whole week.
 *
 * The form posts one open and one close time per day, plus an optional second set for a split
 * shift. A day with neither is simply absent from what goes to the API, which is how "closed" is
 * expressed — there is no separate checkbox, so the form and the database cannot disagree about
 * whether a day is closed.
 */
export async function saveHoursAction(
  listingId: number,
  _previous: HoursState,
  formData: FormData,
): Promise<HoursState> {
  const intervals: OpeningInterval[] = [];

  for (let day = 0; day < 7; day++) {
    for (const slot of ["a", "b"]) {
      const opens = String(formData.get(`opens-${day}${slot}`) ?? "").trim();
      const closes = String(formData.get(`closes-${day}${slot}`) ?? "").trim();

      if (opens === "" && closes === "") {
        continue;
      }

      if (opens === "" || closes === "") {
        return { error: "Each set of hours needs both an opening and a closing time." };
      }

      intervals.push({ dayOfWeek: day, opens, closes });
    }
  }

  const result = await saveOpeningHours(listingId, intervals);
  if (!result.ok) {
    // The API's message names the day that is wrong, which is more use than a generic failure.
    return { error: Object.values(result.fieldErrors)[0] ?? result.message };
  }

  revalidatePath(`/account/listings/${listingId}/hours`);
  return { saved: true };
}
