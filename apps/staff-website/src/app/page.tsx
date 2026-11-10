import { redirect } from "next/navigation";

/**
 * The staff site's front door. There is no dashboard here: the two surfaces live under /admin and
 * /super-admin, and which one you may open is decided by the sign-in, not by this page.
 */
export default function StaffHomePage() {
  redirect("/login");
}
