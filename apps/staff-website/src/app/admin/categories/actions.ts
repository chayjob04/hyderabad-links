"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  assignCategorySegment,
  createCategory,
  createSegment,
  deleteCategory,
  updateCategory,
} from "@/lib/admin-api";
import { categoryListPages, revalidatePublicPages } from "@/lib/revalidate";

/**
 * Server actions for the categories screen. None of them checks a permission: the API checks
 * `taxonomy.manage` on every call, and a server action is just another caller.
 *
 * Each one finishes by redirecting back with a short message in the query string, which is how the
 * listing queue already reports a decision. That keeps this screen server-rendered: no client
 * component, no `useActionState`, and the fresh list is the redirect's own render.
 */
/* Absolute, and under /admin: this screen is at /admin/categories, and a redirect to "/categories"
   lands on the staff 404 instead -- which is where every action on this page used to end,
   success or failure, leaving the Notice below unreachable. */
const DONE = "/admin/categories?done=";
const FAILED = "/admin/categories?error=";

/**
 * The public site caches for 60 seconds, so a category change shows up on its own. This nudges the
 * pages whose *lists* of categories changed, so an admin who adds one and immediately looks at the
 * site sees it. Never throws; a skipped refresh only costs that minute.
 */
async function refreshPublicLists(): Promise<void> {
  // `/categories` is the index of every category and was missing, so adding or switching one off
  // left that page a minute behind while home and search were already right.
  await revalidatePublicPages(categoryListPages());
}

function back(result: { ok: boolean; message?: string }, done: string): never {
  revalidatePath("/admin/categories");
  redirect(result.ok ? DONE + encodeURIComponent(done) : FAILED + encodeURIComponent(result.message ?? "That did not work."));
}

export async function addCategoryAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const rawParent = String(formData.get("parentId") ?? "");
  const parentId = rawParent === "" ? null : Number.parseInt(rawParent, 10);
  const sortOrder = Number.parseInt(String(formData.get("sortOrder") ?? "0"), 10);

  if (name === "") redirect(FAILED + encodeURIComponent("Enter a name."));

  const result = await createCategory({
    name,
    parentId: parentId !== null && Number.isSafeInteger(parentId) ? parentId : null,
    sortOrder: Number.isSafeInteger(sortOrder) ? sortOrder : 0,
  });
  if (result.ok) await refreshPublicLists();
  back(result, parentId === null ? `Added "${name}".` : `Added "${name}" as a subcategory.`);
}

/** Rename and reorder in one submit, because they are the two fields on the same row. */
export async function editCategoryAction(id: number, formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const sortOrder = Number.parseInt(String(formData.get("sortOrder") ?? "0"), 10);

  if (name === "") redirect(FAILED + encodeURIComponent("Enter a name."));

  const result = await updateCategory(id, {
    name,
    sortOrder: Number.isSafeInteger(sortOrder) ? sortOrder : 0,
  });
  if (result.ok) await refreshPublicLists();
  back(result, "Saved.");
}

/**
 * On or off. Off is the safe way to take a category off the public site: the listings sitting on it
 * keep working, and the API also switches off any subcategories underneath.
 */
export async function toggleCategoryAction(id: number, isActive: boolean): Promise<void> {
  const result = await updateCategory(id, { isActive });
  if (result.ok) await refreshPublicLists();
  back(result, isActive ? "Switched on." : "Switched off.");
}

/** Only a category nothing points at. The API refuses the rest and says what is in the way. */
export async function deleteCategoryAction(id: number): Promise<void> {
  const result = await deleteCategory(id);
  if (result.ok) await refreshPublicLists();
  back(result, "Deleted.");
}

/**
 * Adds a segment: the tier above categories.
 *
 * Renaming, reordering, switching off and deleting a segment reuse the category actions above,
 * because a segment is a row in the same table and those endpoints work on any tier. Only creating
 * one is separate, since there is no parent to pass.
 */
export async function addSegmentAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const sortOrder = Number.parseInt(String(formData.get("sortOrder") ?? "0"), 10);

  if (name === "") redirect(FAILED + encodeURIComponent("Enter a name."));

  const result = await createSegment({
    name,
    sortOrder: Number.isSafeInteger(sortOrder) ? sortOrder : 0,
  });
  if (result.ok) await refreshPublicLists();
  back(result, `Added the "${name}" segment.`);
}

/**
 * Moves a category under a segment, or out from under one.
 *
 * Nothing about the category's own address changes: segments sit above the tree rather than inside
 * the path, so /restaurants-and-food stays where it is whichever segment it belongs to. That is why
 * this is safe to do from a dropdown without a confirmation.
 */
export async function assignSegmentAction(id: number, formData: FormData): Promise<void> {
  const raw = String(formData.get("segmentId") ?? "");
  const segmentId = raw === "" ? null : Number.parseInt(raw, 10);

  const result = await assignCategorySegment(
    id,
    segmentId !== null && Number.isSafeInteger(segmentId) ? segmentId : null,
  );
  if (result.ok) await refreshPublicLists();
  back(result, segmentId === null ? "Taken out of its segment." : "Moved.");
}
