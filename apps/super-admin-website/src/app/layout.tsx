import type { Metadata, Viewport } from "next";
import { Mulish } from "next/font/google";
import { BRAND_NAME } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${BRAND_NAME} Super Admin`, template: `%s | ${BRAND_NAME} Super Admin` },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/*
 * Mulish, the body face the original Hyderabad Links used. Loaded through next/font, which
 * downloads it at build time and serves it from this origin -- so there is no request to Google on
 * a page load, and no layout shift while a webfont arrives.
 */
const mulish = Mulish({ subsets: ["latin"], variable: "--font-mulish", display: "swap" });

// Read APP_ENV at request time so the same build can run in staging and production.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const environment = process.env.APP_ENV ?? "LOCAL";
  return (
    <html lang="en" className={mulish.variable}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <div className="flex items-center justify-between bg-red-700 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white">
          <span>SUPER ADMIN</span>
          <span>{environment}</span>
        </div>
        {children}
      </body>
    </html>
  );
}
