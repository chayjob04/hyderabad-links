"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addScrollingText,
  deleteScrollingText,
  setCategoryPopular,
  setCategorySortOrder,
  setScrollingTextActive,
} from "@/lib/admin-api";
import { revalidatePublicPages } from "@/lib/revalidate";

/**
 * Every action here revalidates the public homepage. Both of these are rendered *into* that page
 * rather than read per request, so without it a change would sit invisible until the cache expired
 * — which is the thing that makes a curation screen feel broken.
 */
async function back(path: string, message: string): Promise<never> {
  await revalidatePublicPages(["/"]);
  revalidatePath(path);
  redirect(`${path}?done=${encodeURIComponent(message)}`);
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function togglePopularAction(id: number, isPopular: boolean): Promise<void> {
  const result = await setCategoryPopular(id, isPopular);
  if (!result.ok) fail("/admin/homepage/popular-categories", result.message);

  await back(
    "/admin/homepage/popular-categories",
    isPopular ? "Added to the homepage." : "Removed from the homepage.",
  );
}

export async function moveCategoryAction(formData: FormData): Promise<void> {
  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  const sortOrder = Number.parseInt(String(formData.get("sortOrder") ?? ""), 10);
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(sortOrder)) {
    fail("/admin/homepage/popular-categories", "That position is not a number.");
  }

  const result = await setCategorySortOrder(id, sortOrder);
  if (!result.ok) fail("/admin/homepage/popular-categories", result.message);

  await back("/admin/homepage/popular-categories", "Order saved.");
}

export async function addLineAction(formData: FormData): Promise<void> {
  const message = String(formData.get("message") ?? "").trim();
  const rawUrl = String(formData.get("url") ?? "").trim();
  const sortOrder = Number.parseInt(String(formData.get("sortOrder") ?? "0"), 10);

  const result = await addScrollingText(
    message,
    rawUrl === "" ? null : rawUrl,
    Number.isSafeInteger(sortOrder) ? sortOrder : 0,
  );
  if (!result.ok) {
    fail("/admin/homepage/scrolling-text", Object.values(result.fieldErrors)[0] ?? result.message);
  }

  await back("/admin/homepage/scrolling-text", "Added.");
}

export async function toggleLineAction(id: number, isActive: boolean): Promise<void> {
  const result = await setScrollingTextActive(id, isActive);
  if (!result.ok) fail("/admin/homepage/scrolling-text", result.message);

  await back("/admin/homepage/scrolling-text", isActive ? "Switched on." : "Switched off.");
}

export async function deleteLineAction(id: number): Promise<void> {
  const result = await deleteScrollingText(id);
  if (!result.ok) fail("/admin/homepage/scrolling-text", result.message);

  await back("/admin/homepage/scrolling-text", "Removed.");
}
