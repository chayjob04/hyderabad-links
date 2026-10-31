import type { Metadata, Viewport } from "next";
import { Capriola, Mulish } from "next/font/google";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { BRAND_NAME } from "@/lib/brand";
import { absoluteUrl } from "@/lib/format";
import "./globals.css";

const DESCRIPTION = "Find trusted local businesses and services across Hyderabad.";

export const metadata: Metadata = {
  /*
   * metadataBase makes every relative URL in metadata absolute — canonical tags, Open Graph images,
   * the lot. Without it Next.js emits relative og:image paths, which no social platform resolves.
   *
   * Read at runtime from the same place canonical links come from, so the two can never disagree,
   * and so a preview card on the deployed site does not point at localhost.
   */
  metadataBase: new URL(absoluteUrl("/")),
  title: { default: `${BRAND_NAME} | Local business directory for Hyderabad`, template: `%s | ${BRAND_NAME}` },
  description: DESCRIPTION,

  /*
   * Link previews. The site had none at all, so a listing shared into WhatsApp — which this
   * directory tells people to use to contact a business — arrived as a bare URL with no name, no
   * description and no picture.
   *
   * Pages that set their own openGraph title and description override these; everything else gets
   * the site's.
   */
  openGraph: {
    type: "website",
    siteName: BRAND_NAME,
    locale: "en_IN",
    title: `${BRAND_NAME} | Local business directory for Hyderabad`,
    description: DESCRIPTION,
    images: [{ url: "/hyderabad-links-logo.png", alt: BRAND_NAME }],
  },
  twitter: {
    // "summary" rather than "summary_large_image": the only image here is a square emblem, and the
    // large card would letterbox it. Swap both when there is a proper 1200x630 card to use.
    card: "summary",
    title: `${BRAND_NAME} | Local business directory for Hyderabad`,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/*
 * The original Hyderabad Links set headings in Capriola and body text in Mulish. Both come through
 * next/font, which downloads them at build time and serves them from this origin: no request to
 * Google on a page load, and no flash of a fallback face while a webfont arrives.
 *
 * Capriola has one weight, which is the point of using it only for headings -- it is a display
 * face, and body copy needs a regular and a bold.
 */
const mulish = Mulish({ subsets: ["latin"], variable: "--font-mulish", display: "swap" });
const capriola = Capriola({ subsets: ["latin"], weight: "400", variable: "--font-capriola", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mulish.variable} ${capriola.variable}`}>
      <body className="min-h-screen bg-white font-sans text-ink antialiased">
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
