import type { Metadata, Viewport } from "next";
import { Mulish } from "next/font/google";
import { BRAND_NAME } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${BRAND_NAME} Staff`, template: `%s | ${BRAND_NAME} Staff` },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/*
 * Mulish, the body face the original Hyderabad Links used. Loaded through next/font, which
 * downloads it at build time and serves it from this origin -- so there is no request to Google on
 * a page load, and no layout shift while a webfont arrives.
 */
const mulish = Mulish({ subsets: ["latin"], variable: "--font-mulish", display: "swap" });

/*
 * The shell for both staff surfaces.
 *
 * The "ADMIN" / "SUPER ADMIN" band that used to live here has moved into app/admin/layout.tsx and
 * app/super-admin/layout.tsx, because this one file is now shared by both and the sign-in page that
 * leads to either. A band naming the wrong surface would be worse than no band: the whole point of
 * it is to tell you, at a glance, which powers the page you are looking at carries.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mulish.variable}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
