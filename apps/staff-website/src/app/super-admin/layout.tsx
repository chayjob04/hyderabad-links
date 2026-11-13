import type { Metadata } from "next";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: `${BRAND_NAME} Super Admin`, template: `%s | ${BRAND_NAME} Super Admin` },
  robots: { index: false, follow: false, nocache: true },
};

// Read APP_ENV at request time so the same build can run in staging and production.
export const dynamic = "force-dynamic";

/**
 * Everything under /super-admin: the platform administration surface.
 *
 * The band that used to sit here — "SUPER ADMIN" and the environment — has moved into the topbar
 * of the Minia shell (see components/minia/MiniaShell.tsx). It had to: the original theme's header
 * is `position: fixed` at the top of the viewport, so a strip above it would have been covered by
 * it. The information is unchanged, and still on every screen.
 */
export default function SuperAdminSurfaceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
