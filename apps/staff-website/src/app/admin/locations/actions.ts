"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createLocality, deleteLocality, updateLocality } from "@/lib/admin-api";
import { localityListPages, localityPages, revalidatePublicPages } from "@/lib/revalidate";

/**
 * Server actions for the locations screen. Like the categories ones: no permission check here, the
 * API checks `taxonomy.manage` on every call, and the result comes back as a message in the query
 * string so the screen stays server-rendered.
 */
/* Absolute, and under /admin: this screen is at /admin/locations, and a redirect to "/locations"
   lands on the staff 404 instead -- which is where every action on this page used to end,
   success or failure, leaving the Notice below unreachable. */
const DONE = "/admin/locations?done=";
const FAILED = "/admin/locations?error=";

/* `/areas` is the index of every area and was missing. A newly added area needs only these: its
   own page cannot be stale, because nothing has rendered it yet. */
async function refreshPublicLists(): Promise<void> {
  await revalidatePublicPages(localityListPages());
}

/* An edit, a switch-off or a delete does change the area's own page, and `/areas/[locality]` is
   buildable from the slug alone -- no parent to thread, unlike a category. The slug is bound at the
   form, where the row already has it. */
async function refreshArea(slug: string): Promise<void> {
  await revalidatePublicPages(localityPages(slug));
}

function back(result: { ok: boolean; message?: string }, done: string): never {
  revalidatePath("/admin/locations");
  redirect(result.ok ? DONE + encodeURIComponent(done) : FAILED + encodeURIComponent(result.message ?? "That did not work."));
}

/**
 * A locality needs a centre point: it is what "near me" and every distance on the site are measured
 * from. The API checks the ranges again, including the swapped-pair case.
 */
function readPoint(formData: FormData): { latitude: number; longitude: number } | null {
  const latitude = Number.parseFloat(String(formData.get("latitude") ?? ""));
  const longitude = Number.parseFloat(String(formData.get("longitude") ?? ""));
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

export async function addLocalityAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const citySlug = String(formData.get("citySlug") ?? "").trim();
  const pincode = String(formData.get("pincode") ?? "").trim();
  const point = readPoint(formData);

  if (name === "") redirect(FAILED + encodeURIComponent("Enter a name."));
  if (citySlug === "") redirect(FAILED + encodeURIComponent("Choose a city."));
  if (point === null) {
    redirect(FAILED + encodeURIComponent("Enter the latitude and longitude of the area's centre."));
  }

  const result = await createLocality({
    citySlug,
    name,
    latitude: point.latitude,
    longitude: point.longitude,
    pincode: pincode === "" ? null : pincode,
  });
  if (result.ok) await refreshPublicLists();
  back(result, `Added "${name}".`);
}

export async function editLocalityAction(id: number, slug: string, formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const pincode = String(formData.get("pincode") ?? "").trim();
  const point = readPoint(formData);

  if (name === "") redirect(FAILED + encodeURIComponent("Enter a name."));
  if (point === null) {
    redirect(FAILED + encodeURIComponent("Enter the latitude and longitude of the area's centre."));
  }

  // The pincode is sent as "" to clear it, which the API reads as "remove the pincode".
  const result = await updateLocality(id, {
    name,
    latitude: point.latitude,
    longitude: point.longitude,
    pincode,
  });
  if (result.ok) await refreshArea(slug);
  back(result, "Saved.");
}

/** Off takes the area off the public site and leaves the listings in it alone. */
export async function toggleLocalityAction(id: number, slug: string, isActive: boolean): Promise<void> {
  const result = await updateLocality(id, { isActive });
  if (result.ok) await refreshArea(slug);
  back(result, isActive ? "Switched on." : "Switched off.");
}

/** Only an area no listing sits in. The API refuses the rest and says how many are in the way. */
export async function deleteLocalityAction(id: number, slug: string): Promise<void> {
  const result = await deleteLocality(id);
  if (result.ok) await refreshArea(slug);
  back(result, "Deleted.");
}
