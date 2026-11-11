"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { setAccountStatus } from "@/lib/super-admin-api";

/**
 * Suspends or reinstates a business owner's account.
 *
 * No permission check here: the API requires admins.manage against a super-admin token, and a
 * server action is just another caller. The reason that permission and not users.view is that this
 * takes the person's listings off the public site with them.
 */
export async function setAccountStatusAction(
  id: number,
  status: "active" | "suspended",
): Promise<void> {
  const result = await setAccountStatus(id, status);
  if (!result.ok) {
    redirect(`/super-admin/accounts/${id}?error=${encodeURIComponent(result.message)}`);
  }

  revalidatePath(`/super-admin/accounts/${id}`);
  revalidatePath("/super-admin/accounts");
  redirect(
    `/super-admin/accounts/${id}?done=${encodeURIComponent(
      status === "suspended" ? "Account suspended." : "Account reinstated.",
    )}`,
  );
}
