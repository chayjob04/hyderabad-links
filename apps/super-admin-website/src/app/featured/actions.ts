"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { unfeatureListing } from "@/lib/super-admin-api";
import { revalidatePublicPages } from "@/lib/revalidate";

/**
 * Takes one listing off the homepage shelf, from the shelf's own page.
 *
 * The public homepage is revalidated because that is the page the change is for: the shelf would
 * otherwise be right here and stale for every visitor until the cache window ran out.
 */
export async function removeFromShelfAction(listingId: number): Promise<void> {
  const result = await unfeatureListing(listingId);
  if (!result.ok) {
    redirect(`/featured?error=${encodeURIComponent(result.message)}`);
  }

  await revalidatePublicPages(["/"]);
  revalidatePath("/featured");
  revalidatePath("/listings/" + listingId);
  redirect(`/featured?done=${encodeURIComponent("Taken off the shelf.")}`);
}
