import { redirect } from "next/navigation";

/**
 * /my has no landing page of its own. Saved is what a customer comes here for, so that is where the
 * bare prefix goes — rather than inventing a dashboard with nothing on it.
 */
export default function CustomerHome() {
  redirect("/my/saved");
}
