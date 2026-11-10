import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.join(__dirname, "../../");

/* Content-Security-Policy. Stricter than the public site's, because nothing here needs a third
 * party: no payment window, no external images, no analytics. The only allowance is 'unsafe-inline'
 * for the scripts and styles Next.js's App Router inlines to hydrate a page — removing that needs a
 * per-request nonce through middleware, which is a deliberate change rather than part of a security
 * pass.
 *
 * img-src allows https: because a moderator's screens show listing photos, which are served from
 * Blob Storage or a CDN whose host is configured at deploy time.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
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
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
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
