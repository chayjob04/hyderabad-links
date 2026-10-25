import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.join(__dirname, "../../");

/* Content-Security-Policy. The one notable header this project was missing.
 *
 * `script-src` keeps 'unsafe-inline' because Next.js's App Router inlines the scripts that hydrate
 * a page, and removing it needs a per-request nonce threaded through middleware — a change worth
 * making deliberately rather than as part of a security pass, since getting it wrong means a blank
 * page. What this policy does buy, even with that allowance, is real: no plugins (`object-src`), no
 * base-tag hijack (`base-uri`), nobody framing the site (`frame-ancestors`), no form posting to
 * another origin (`form-action`), and no connections, images, fonts or frames from anywhere this
 * list does not name.
 *
 * Razorpay's checkout is named explicitly: it loads a script from checkout.razorpay.com and opens
 * its payment window in an iframe from api.razorpay.com. Without both of those the ₹399 payment
 * simply would not open. Card details are entered in their frame, which is the point — they never
 * touch this origin.
 *
 * 'unsafe-inline' for styles is Tailwind and Next's injected style tags.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline'",
  // Listing photos come from Blob Storage or a CDN, and both are configured at deploy time rather
  // than known here, so https: is as tight as this can honestly be. data: is for inline SVG icons.
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  // The browser talks only to this site's own server (CLAUDE.md: it never calls the API directly),
  // plus Razorpay's checkout while a payment is open.
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },

].filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone", // small, self-contained build for Azure App Service
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
