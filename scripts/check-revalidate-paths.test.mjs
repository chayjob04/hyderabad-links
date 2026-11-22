import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every public path the staff site can ask to revalidate must be a route the public site has.
 *
 * This exists because a wrong path is silently useless rather than an error. `/api/revalidate`
 * accepts any well-formed path, and `revalidatePath` on one that matches no route does nothing --
 * no throw, no log, no failing test. So `pagesAffectedBy` spent its whole life sending
 * `/{city}/{locality}/{category}`, a shape the public site has no route for, and the category page
 * it was meant to refresh never once was.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const appDir = join(repoRoot, "apps", "main-website", "src", "app");
const revalidateFile = join(repoRoot, "apps", "staff-website", "src", "lib", "revalidate.ts");

/** Every route the public app serves, as an array of segments. `[x]` marks a dynamic one. */
function readRoutes(dir, prefix = []) {
  const routes = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return routes;
  }

  if (entries.includes("page.tsx") || entries.includes("route.ts")) {
    routes.push(prefix);
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith("_")) continue;
    // A route group `(name)` adds no segment.
    const segments = entry.startsWith("(") && entry.endsWith(")") ? prefix : [...prefix, entry];
    routes.push(...readRoutes(full, segments));
  }

  return routes;
}

/**
 * The paths `revalidate.ts` can emit, with each interpolation reduced to one `[dyn]` segment.
 *
 * Comments are stripped first. The file documents the public route tree in a comment block, and the
 * first version of this reader scraped those shapes and then complained that the listing pattern
 * was not a route -- it is a route *pattern*, written for a human. Only code emits paths.
 */
function readEmittedPaths(rawSource) {
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const paths = new Set();

  for (const match of source.matchAll(/["'](\/[A-Za-z0-9\-/]*)["']/g)) {
    paths.add(match[1]);
  }

  for (const match of source.matchAll(/`(\/[^`]*)`/g)) {
    const template = match[1];
    paths.add(template.includes("${") ? template.replace(/\$\{[^}]*\}/g, "[dyn]") : template);
  }

  return [...paths].sort();
}

function toSegments(path) {
  return path.split("/").filter((segment) => segment !== "");
}

/**
 * Whether an emitted path corresponds to a route, matched strictly segment by segment: a literal
 * must equal the route's literal, and an interpolation must sit where the route is dynamic.
 *
 * The looser rule -- "a dynamic route segment matches anything" -- is almost worthless here,
 * because the public site has a dynamic segment at the top level, so under it every single-segment
 * path matches something and a typo passes. Requiring literals to match literals is what makes this
 * able to fail; it was vacuous until that was fixed.
 *
 * What it still cannot see: a correctly shaped path built from the wrong values. Three
 * interpolations look exactly like a real listing path whatever is interpolated into them, so that
 * regression has its own named test below, which is the only kind of check that can catch it.
 */
function matchesRoute(pathSegments, routeSegments) {
  if (pathSegments.length !== routeSegments.length) return false;
  return routeSegments.every((routeSegment, index) => {
    const pathSegment = pathSegments[index];
    const routeIsDynamic = routeSegment.startsWith("[");
    const pathIsDynamic = pathSegment === "[dyn]";
    return pathIsDynamic ? routeIsDynamic : !routeIsDynamic && routeSegment === pathSegment;
  });
}

const routes = readRoutes(appDir);
const emitted = readEmittedPaths(readFileSync(revalidateFile, "utf8"));

test("the public route tree is readable, so the rest of this file means something", () => {
  // Guards the guard: an empty tree would make every assertion below pass by vacuity.
  assert.ok(routes.length > 20, "only found " + routes.length + " routes under " + appDir);
  const asPaths = routes.map((segments) => "/" + segments.join("/"));
  for (const expected of ["/", "/search", "/categories", "/areas", "/blog"]) {
    assert.ok(asPaths.includes(expected), "expected the public site to have " + expected);
  }
});

test("revalidate.ts mentions a believable number of paths", () => {
  assert.ok(emitted.length >= 8, "only extracted " + emitted.length + " paths; the reader has broken");
});

test("every path revalidate.ts can emit is a real public route", () => {
  const unmatched = emitted.filter((path) => {
    const segments = toSegments(path);
    return !routes.some((route) => matchesRoute(segments, route));
  });

  assert.deepEqual(unmatched, [], "these paths match no route: " + unmatched.join(", "));
});

test("the listing path shape is the category one, not a city one", () => {
  // The specific regression. A listing lives under its category, not under its city and locality.
  const source = readFileSync(revalidateFile, "utf8");
  assert.ok(
    !/\$\{\s*listing\.citySlug\s*\}\/\$\{\s*listing\.localitySlug\s*\}/.test(source),
    "revalidate.ts is building a city/locality path again; that matches no public route",
  );
});

test("no emitted path is a staff or API route", () => {
  const wrong = emitted.filter((path) => /^\/(admin|super-admin|api)(\/|$)/.test(path));
  assert.deepEqual(wrong, [], "revalidate.ts should not emit " + wrong.join(", "));
});

test("the static SEO keys all map to real pages", () => {
  // The keys come from AdminSeoEndpoints.StaticPageKeys. Each must map to a route, or an SEO
  // override on that page would refresh nothing. Read from the API so the two cannot drift.
  const seoSource = readFileSync(
    join(repoRoot, "backend", "BusinessDirectory.Api", "Endpoints", "AdminSeoEndpoints.cs"),
    "utf8",
  );
  /* Comments inside the array are stripped first. The one above the four index keys explains that
     the website used to read them under an entity type of "page" rather than "static", and reading
     those two words as keys made this report keys that are not keys. */
  const declared = [...seoSource.matchAll(/StaticPageKeys\s*=\s*\n?\s*\[([^\]]*)\]/g)].flatMap((match) =>
    [
      ...match[1]
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*/g, "")
        .matchAll(/"([a-z]+)"/g),
    ].map((key) => key[1]),
  );

  assert.ok(declared.length >= 5, "expected to read the static page keys, got " + declared.length);

  const source = readFileSync(revalidateFile, "utf8");
  const mapped = new Set(
    [...source.matchAll(/^\s*([a-z]+):\s*"(\/[A-Za-z0-9\-/]*)"/gm)].map((match) => match[1]),
  );

  const missing = declared.filter((key) => !mapped.has(key));
  assert.deepEqual(missing, [], "revalidate.ts has no page for static SEO key(s): " + missing.join(", "));
});
