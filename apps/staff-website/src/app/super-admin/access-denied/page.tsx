import type { Metadata } from "next";
import { AccessDenied } from "@/components/AccessDenied";

export const metadata: Metadata = { title: "No access", robots: { index: false, follow: false } };

/**
 * The standalone refusal page, for the cases where there is nothing to render underneath — a
 * redirect out of a screen rather than a panel inside one. Pages that know which permission is
 * missing use the `AccessDenied` component directly and name it.
 */
export default function AccessDeniedPage() {
  return <AccessDenied surface="super" />;
}
