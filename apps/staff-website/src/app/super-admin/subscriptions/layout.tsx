import type { Metadata } from "next";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The Minia shell around this section, the way Accounts and Listings do it.
 *
 * Without it the page renders bare: no sidebar, no topbar, and none of the theme's stylesheets,
 * because they are loaded by the shell. It still looked half-right in a screenshot -- Bootstrap
 * class names on unstyled markup -- which is how it was missed until a browser measured the page
 * at 390px and found the table running off the side of it.
 */
export default function SubscriptionsLayout({ children }: { children: React.ReactNode }) {
  return <SuperAdminChrome>{children}</SuperAdminChrome>;
}
