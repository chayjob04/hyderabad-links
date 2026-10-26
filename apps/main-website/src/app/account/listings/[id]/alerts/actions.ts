"use server";

import { revalidatePath } from "next/cache";
import { acknowledgeListingAlert } from "@/lib/owner-api";

/**
 * Marks one alert read.
 *
 * Both paths are revalidated: this page, and the listings page whose card carries the open count.
 * Without the second, an owner who reads an alert would go back to a card still telling them to
 * read it.
 */
export async function acknowledgeAlertAction(listingId: number, alertId: number): Promise<void> {
  await acknowledgeListingAlert(listingId, alertId);
  revalidatePath(`/account/listings/${listingId}/alerts`);
  revalidatePath("/account/listings");
}
