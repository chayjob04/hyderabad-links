import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every path a staff server action redirects to is a page that exists.
 *
 * `/admin/categories` and `/admin/locations` both declared their redirect targets as
 * `"/categories?done="` and `"/locations?error="` -- without the `/admin` prefix the rest of the
 * app uses. Those are not routes, so all eight actions on those two screens (add, rename, switch
 * on or off, delete) finished by sending the administrator to the staff 404 page. The work itself
 * had already been done: the API returned 204, the list was revalidated, and the line directly
 * above each redirect, `revalidatePath("/admin/categories")`, named the right path. Only the person
 * using it ever found out, because they landed on "That screen does not exist" and could not tell
 * whether the category had been deleted.
 *
 * Nothing could have caught it below this level. The HTTP call succeeded, the types were right, and
 * `redirect()` takes any string. It needs the route tree to be the judge, which is what this does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "apps", "staff-website", "src", "app");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(appDir);

/** The routes the app actually serves, as segment arrays. Route groups "(x)" do not appear in URLs. */
const routes = files
  .filter((f) => /[/\\](page|route)\.tsx?$/.test(f))
  .map((f) =>
    relative(appDir, dirname(f))
      .split(/[/\\]/)
      .filter((s) => s !== "" && !s.startsWith("(")),
  );

/**
 * Redirect targets, with template expressions reduced to a single dynamic segment. `${id}` in a
 * path becomes one unknown segment, which is what it is.
 */
function targetsIn(source) {
  const found = [];
  // redirect("..."), redirect('...') and redirect(`...`)
  for (const m of source.matchAll(/redirect\(\s*(["'`])([^"'`]*)\1/g)) found.push(m[2]);
  // the two screens that kept their targets in a constant
  for (const m of source.matchAll(/^\s*const \w+ = (["'])(\/[^"']*)\1/gm)) found.push(m[2]);
  return found;
}

const actionSources = files
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => [relative(appDir, f), readFileSync(f, "utf8")])
  .filter(([, src]) => src.includes("redirect(") || /const \w+ = "\//.test(src));

const targets = [];
for (const [file, src] of actionSources) {
  for (const raw of targetsIn(src)) {
    if (!raw.startsWith("/")) continue; // not a path
    const pathOnly = raw.split("?")[0].split("#")[0];
    const segments = pathOnly
      .split("/")
      .filter((s) => s !== "")
      // "${listingId}" and "" (a trailing slash before an interpolation) are unknown segments
      .map((s) => (s.includes("${") ? "*" : s));
    if (pathOnly.endsWith("/")) segments.push("*");
    targets.push({ file, raw, segments });
  }
}

/** A target matches a route when the lengths agree and each segment agrees. */
function resolves(segments) {
  return routes.some(
    (route) =>
      route.length === segments.length &&
      route.every((routeSeg, i) => {
        const target = segments[i];
        if (target === "*") return true; // unknown value: any segment here is possible
        if (routeSeg.startsWith("[")) return true; // a dynamic route accepts a literal
        return routeSeg === target;
      }),
  );
}

test("the scan finds the staff route tree and its redirects", () => {
  // Guards the guard: with no routes or no targets, every assertion below passes by vacuity.
  assert.ok(routes.length > 30, `only found ${routes.length} staff routes`);
  assert.ok(targets.length > 20, `only found ${targets.length} redirect targets`);
  assert.ok(
    routes.some((r) => r.join("/") === "admin/categories"),
    "the route tree should contain admin/categories",
  );
});

test("every staff redirect target is a route that exists", () => {
  const broken = targets
    .filter((t) => !resolves(t.segments))
    .map((t) => `${t.file} redirects to ${JSON.stringify(t.raw)}`);

  assert.deepEqual(
    [...new Set(broken)],
    [],
    "these redirects send staff to a page that does not exist:\n  " + [...new Set(broken)].join("\n  "),
  );
});

test("a missing route prefix is actually caught", () => {
  // Proves the matcher is not permissive enough to have let the original bug through.
  assert.equal(resolves(["categories"]), false, "'/categories' must not resolve");
  assert.equal(resolves(["locations"]), false, "'/locations' must not resolve");
  assert.equal(resolves(["admin", "categories"]), true, "'/admin/categories' must resolve");
  assert.equal(resolves(["admin", "listings", "*"]), true, "'/admin/listings/${id}' must resolve");
});
