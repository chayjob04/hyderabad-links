import type { Metadata } from "next";
import { AdminChrome } from "@/components/AdminChrome";

// The list and the editor share the chrome, including their error branches -- the part that is
// easy to forget when every page wraps itself.
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <AdminChrome>{children}</AdminChrome>;
}
