import { redirect } from "next/navigation";
import { getMe } from "@/lib/owner-api";

export const dynamic = "force-dynamic";

/**
 * The business-registration gate, which used to sit on the whole /account shell.
 *
 * It moved here because it only ever belonged to the pages that need a business: everything under
 * /account/listings. On the shell it also blocked favourites, profile and settings, which a visitor
 * who has never registered a business has every right to open — and which is where the user tab on
 * the login page lands.
 *
 * `needsOnboarding` is the API's own rule (an account with no name has not registered yet), so the
 * decision is still the server's, taken before any listing page renders.
 */
export default async function OwnerListingsLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (me.ok && me.data.needsOnboarding) redirect("/onboarding");

  return <>{children}</>;
}
