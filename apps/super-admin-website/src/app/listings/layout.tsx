import type { Metadata } from "next";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";

// The other screens here wrap their own content in SuperAdminChrome. A layout does it once for the
// list, the add form and the detail page -- including their error and not-found branches, which is
// the part that is easy to forget when every page wraps itself.
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function ListingsLayout({ children }: { children: React.ReactNode }) {
  return <SuperAdminChrome>{children}</SuperAdminChrome>;
}
