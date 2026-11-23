"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  approveSuggestion,
  markSuggestionExists,
  rejectSuggestion,
} from "@/lib/admin-api";
import { categoryListPages, localityListPages, revalidatePublicPages } from "@/lib/revalidate";

/**
 * Server actions for the suggestions queue (S0032). None of them checks a permission: the API
 * checks `taxonomy.manage` on every call, locks the request so two admins cannot decide it twice,
 * and refuses anything that is no longer pending.
 *
 * Each one redirects back with a short message, the way the categories screen does, so the page
 * stays server-rendered and the fresh queue is the redirect's own render.
 */
const DONE = "/admin/suggestions?done=";
const FAILED = "/admin/suggestions?error=";

function back(result: { ok: boolean; message?: string }, done: string): never {
  revalidatePath("/admin/suggestions");
  redirect(
    result.ok
      ? DONE + encodeURIComponent(done)
      : FAILED + encodeURIComponent(result.message ?? "That did not work."),
  );
}

/**
 * Approves a request, which creates the area or the category.
 *
 * The form carries what only a person can supply. An area needs a city and a point on the map --
 * "near me" ranks by distance from it -- and a category needs the category it will sit under,
 * because a business can only be filed under a subcategory. The API validates all of it again and
 * is the authority; this only shapes the request.
 */
export async function approveSuggestionAction(
  id: number,
  kind: "locality" | "category",
  formData: FormData,
): Promise<void> {
  const text = (field: string) => {
    const value = String(formData.get(field) ?? "").trim();
    return value === "" ? undefined : value;
  };
  const number = (field: string) => {
    const value = text(field);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const result = await approveSuggestion(
    id,
    kind === "locality"
      ? {
          name: text("name"),
          citySlug: text("citySlug"),
          latitude: number("latitude"),
          longitude: number("longitude"),
          pincode: text("pincode"),
        }
      : { name: text("name"), parentId: number("parentId"), sortOrder: number("sortOrder") ?? 0 },
  );

  /* The public lists that gained a row. A category or area appears on the site within the minute
     anyway; this is so an admin who approves one and looks straight away sees it there. */
  if (result.ok) {
    await revalidatePublicPages(kind === "locality" ? localityListPages() : categoryListPages());
  }

  back(result, kind === "locality" ? "Area added." : "Category added.");
}

/** Refuses the request, with the note the owner reads. */
export async function rejectSuggestionAction(id: number, formData: FormData): Promise<void> {
  const note = String(formData.get("note") ?? "").trim();
  if (note === "") redirect(FAILED + encodeURIComponent("Say why. The owner reads this."));

  back(await rejectSuggestion(id, note), "Sent back.");
}

/**
 * Marks a request as already in the directory, with the note naming what to use instead.
 *
 * Kept separate from a rejection because it is a different answer: the owner was right to ask, and
 * "no" would be both wrong and unhelpful.
 */
export async function markExistsAction(id: number, formData: FormData): Promise<void> {
  const note = String(formData.get("note") ?? "").trim();
  if (note === "") {
    redirect(FAILED + encodeURIComponent("Say which area or category to use instead."));
  }

  back(await markSuggestionExists(id, note), "Marked as already there.");
}
