import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every staff screen is inside the Minia shell.
 *
 * The shell is what loads the theme's stylesheets and draws the sidebar and topbar, and in this app
 * it is applied per section -- some sections have a `layout.tsx` that wraps it, others wrap it in
 * the page itself. Both work; forgetting both also "works", in the sense that the page renders.
 * What it renders is Bootstrap class names on unstyled markup with no navigation, which reads as a
 * styling glitch rather than as a missing layout. A subscriptions page shipped that way and was
 * only caught when a browser measured it at 390px and found a table hanging off the side.
 *
 * So: a page under /admin or /super-admin must either name the chrome itself or sit under a layout
 * that does. Access-denied screens are deliberately outside it -- they are what somebody sees when
 * they may not have the surface at all.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "apps", "staff-website", "src", "app");

/** Screens that are outside the shell on purpose. */
const OUTSIDE = [
  join("admin", "access-denied"),
  join("super-admin", "access-denied"),
];

const CHROME = /\b(AdminChrome|SuperAdminChrome|MiniaShell)\b/;

/* Comments stripped first. The surface's own layout explains in prose where the shell went, and
   naming it there satisfied the search -- so every page under /super-admin passed whether or not it
   had the shell, and this test said nothing for the first few minutes of its life. It is the second
   time in this project that a scan has read a comment as code. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function pages(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

/**
 * True when the page renders nothing of its own: its whole job is `redirect(...)`.
 *
 * /admin and /super-admin are both of these -- they send people to the first real screen -- and a
 * page that renders no markup needs no shell around it.
 */
function onlyRedirects(source) {
  return /\bredirect\(/.test(source) && !/\breturn\s*\(/.test(source) && !/<[A-Za-z]/.test(source);
}

/** True when this page, or any layout above it inside the surface, applies the shell. */
function wrapped(pagePath) {
  if (CHROME.test(code(readFileSync(pagePath, "utf8")))) return true;

  let dir = dirname(pagePath);
  const stop = appDir;
  while (dir.startsWith(stop)) {
    const layout = join(dir, "layout.tsx");
    if (existsSync(layout) && CHROME.test(code(readFileSync(layout, "utf8")))) return true;
    if (dir === stop) break;
    dir = dirname(dir);
  }
  return false;
}

test("every admin and super-admin screen is inside the Minia shell", () => {
  const surfaces = ["admin", "super-admin"].map((name) => join(appDir, name));
  const bare = [];

  for (const surface of surfaces) {
    for (const page of pages(surface)) {
      const rel = relative(appDir, page);
      if (OUTSIDE.some((allowed) => rel.startsWith(allowed + sep))) continue;
      if (onlyRedirects(code(readFileSync(page, "utf8")))) continue;
      if (!wrapped(page)) bare.push(rel);
    }
  }

  assert.deepEqual(
    bare,
    [],
    "these render without the sidebar, the topbar or the theme's stylesheets:\n  " + bare.join("\n  "),
  );
});

test("the screens that are outside the shell are the ones meant to be", () => {
  // If one of these ever gains the shell, this test is the reminder to delete its exemption rather
  // than leave a list that no longer describes anything.
  for (const allowed of OUTSIDE) {
    const page = join(appDir, allowed, "page.tsx");
    assert.equal(existsSync(page), true, `${allowed} is exempted but does not exist`);
    assert.equal(
      CHROME.test(code(readFileSync(page, "utf8"))),
      false,
      `${allowed} now uses the shell, so it no longer needs an exemption`,
    );
  }
});
