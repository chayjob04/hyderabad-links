import "./minia-compat.css";

/**
 * The original theme's stylesheets, loaded in the order the Razor layouts loaded them.
 *
 * The four files under /assets/admin/css are byte-for-byte the originals — Minia 2.4.0 by
 * Themesbrand on Bootstrap 5.3.3 — and they are served from `public/` rather than imported as
 * modules on purpose. The bundler resolves every `url()` at build time and would fail on the
 * .eot/.ttf/.svg font variants we deliberately did not copy; served statically, the browser reads
 * the same `@font-face` list, finds woff2 first and never asks for the rest.
 *
 * `precedence` is what makes React hoist these into <head> and keep them in this order. All four
 * share one precedence group, so insertion order is preserved: bootstrap, then icons, then the
 * theme, then the preloader — exactly as _AdminLayout.cshtml had them.
 *
 * app.min.css carries its own `@import` of IBM Plex Sans from Google Fonts. That import is the
 * original's, left untouched: removing it would change the typeface and so change the thing being
 * reproduced. It is the one external request these panels make.
 */
const SHEETS = [
  "/assets/admin/css/bootstrap.min.css",
  "/assets/admin/css/icons.min.css",
  "/assets/admin/css/app.min.css",
  "/assets/admin/css/preloader.min.css",
];

export function MiniaStyles() {
  return (
    <>
      {SHEETS.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="minia" />
      ))}
    </>
  );
}
