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
 * The band is here rather than in the root layout because the root is now shared with
 * /super-admin and with the sign-in page that leads to either. Naming the surface on every screen
 * is how someone with both roles knows which one they are acting as.
 */
export default function SuperAdminSurfaceLayout({ children }: { children: React.ReactNode }) {
  const environment = process.env.APP_ENV ?? "LOCAL";
  return (
    <>
      <div className="flex items-center justify-between bg-neutral-800 px-4 py-2 text-xs font-semibold tracking-wider text-white uppercase">
        <span>SUPER ADMIN</span>
        <span>{environment}</span>
      </div>
      {children}
    </>
  );
}
