"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createHomepageGroup,
  deleteHomepageGroup,
  featureListingInGroup,
  updateHomepageGroup,
} from "@/lib/super-admin-api";
import { revalidatePublicPages } from "@/lib/revalidate";

/**
 * Every one of these refreshes the public homepage, because that is the page the change is for.
 * Without it the shelf would be right in this panel and stale for every visitor until the cache
 * window ran out, which is the kind of thing that makes somebody press the button twice.
 */
async function refresh(): Promise<void> {
  await revalidatePublicPages(["/"]);
  revalidatePath("/featured");
}

function read(formData: FormData) {
  const sortOrder = Number.parseInt(String(formData.get("sortOrder") ?? "0"), 10);
  return {
    title: String(formData.get("title") ?? "").trim(),
    subtitle: String(formData.get("subtitle") ?? "").trim(),
    sortOrder: Number.isSafeInteger(sortOrder) ? sortOrder : 0,
    isActive: formData.get("isActive") === "on",
  };
}

export async function createGroupAction(formData: FormData): Promise<void> {
  const result = await createHomepageGroup(read(formData));
  if (!result.ok) {
    // A full homepage and a blank heading are both refused with a reason worth reading.
    redirect(`/featured?error=${encodeURIComponent(Object.values(result.fieldErrors)[0] ?? result.message)}`);
  }

  await refresh();
  redirect(`/featured?done=${encodeURIComponent("Shelf created.")}`);
}

export async function updateGroupAction(groupId: number, formData: FormData): Promise<void> {
  const result = await updateHomepageGroup(groupId, read(formData));
  if (!result.ok) {
    redirect(`/featured?error=${encodeURIComponent(Object.values(result.fieldErrors)[0] ?? result.message)}`);
  }

  await refresh();
  redirect(`/featured?done=${encodeURIComponent("Saved.")}`);
}

/**
 * Removes a shelf. Its listings stay featured and return to the default shelf — deleting a shelf
 * is a decision about presentation, and un-featuring businesses somebody chose is a different one.
 */
export async function deleteGroupAction(groupId: number): Promise<void> {
  const result = await deleteHomepageGroup(groupId);
  if (!result.ok) {
    redirect(`/featured?error=${encodeURIComponent(result.message)}`);
  }

  await refresh();
  redirect(`/featured?done=${encodeURIComponent("Shelf removed. Its listings are back on the default shelf.")}`);
}

/** Moves one featured listing between shelves. Group 0 is the default shelf. */
export async function moveToGroupAction(listingId: number, formData: FormData): Promise<void> {
  const groupId = Number.parseInt(String(formData.get("groupId") ?? "0"), 10);
  const result = await featureListingInGroup(listingId, Number.isSafeInteger(groupId) ? groupId : 0);

  if (!result.ok) {
    redirect(`/featured?error=${encodeURIComponent(result.message)}`);
  }

  await refresh();
  redirect(`/featured?done=${encodeURIComponent("Moved.")}`);
}
