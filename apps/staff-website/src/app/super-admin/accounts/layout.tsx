import type { Metadata } from "next";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return <SuperAdminChrome>{children}</SuperAdminChrome>;
}
