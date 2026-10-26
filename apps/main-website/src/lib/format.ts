export function formatDistance(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
}

export const telHref = (phone: string) => `tel:${phone}`;
export const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
export const mapsHref = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/**
 * The origin every canonical link, sitemap entry and structured-data URL is built on.
 *
 * SITE_URL first, because it is the only setting that can name the real public domain.
 *
 * Then Vercel's own `VERCEL_PROJECT_PRODUCTION_URL`, which it sets on every deployment to the
 * project's production domain (the custom domain once one is attached). That fallback exists
 * because the previous code dropped straight to `http://localhost:3000` when SITE_URL was unset --
 * and SITE_URL was in fact unset on the deployed site, so the live pages were publishing
 * `<link rel="canonical" href="http://localhost:3000/...">` and a sitemap full of localhost URLs.
 * A canonical tag pointing at a host a crawler cannot reach is worse than none at all: it tells
 * Google the real page is somewhere else. Vercel always sets this variable, so on the deployed site
 * the localhost branch below is now unreachable even if SITE_URL is forgotten again.
 *
 * localhost stays as the last resort on purpose rather than throwing: `next build` prerenders these
 * pages with NODE_ENV=production and neither variable set, and a throw would turn a missing
 * environment variable into a failed build for every developer and for CI.
 */
function siteOrigin(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production.replace(/\/$/, "")}`;

  return "http://localhost:3000";
}

/** Absolute URL for canonical links and structured data. Read at runtime on the server. */
export function absoluteUrl(path: string): string {
  return `${siteOrigin()}${path}`;
}

/**
 * A price for display. The database stores paise, so ₹399 arrives as 39900.
 *
 * Shared rather than copied because three screens now show the same price, and a plan whose price
 * reads differently on the plans page and on the listing card is worse than one that is hard to
 * find. The number itself always comes from the `plans` table, never from here.
 */
export function rupees(paise: number): string {
  const whole = paise / 100;
  return `₹${whole.toLocaleString("en-IN", { maximumFractionDigits: whole % 1 === 0 ? 0 : 2 })}`;
}
