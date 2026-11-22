import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The two sides of the SEO override feature address the same page by the same name.
 *
 * `page_meta` lets staff replace a page's title, description, Open Graph image and robots
 * directive. The admin panel writes a row; the public site reads one. Nothing connected the two
 * names, and they had drifted apart in both directions at once:
 *
 *   - Five public screens -- /categories, /areas, /trending, /verified and /groups/<slug> -- looked
 *     up their override with an `entity_type` of "page". S0021's CHECK allows only listing,
 *     category, locality and static, so no such row can exist. Those lookups could never match:
 *     the override an admin wrote for the categories page did nothing, for ever.
 *   - Five keys the panel offered -- search, terms, privacy, help, blog -- were read by no page at
 *     all. The form saved, the row was stored, and the page kept its own title.
 *
 * Of sixteen addressable pages, six worked. Neither half could fail a build, a type check or an API
 * test: both sides were internally valid and simply disagreed. So the names are checked here, from
 * the source of each side.
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicApp = join(here, "..", "apps", "main-website", "src", "app");
const seoEndpoints = join(
  here, "..", "backend", "BusinessDirectory.Api", "Endpoints", "AdminSeoEndpoints.cs",
);
const migration = join(
  here, "..", "database", "sqlserver", "migrations", "S0021__page_meta.sql",
);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const pages = walk(publicApp).filter((f) => /[/\\]page\.tsx$/.test(f));

/** Every override lookup the public site performs: { entityType, key, literal, file }. */
const lookups = [];
for (const file of pages) {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(/getPageMeta\(\s*"([a-z]+)"\s*,\s*([^)]+?)\s*\)/g)) {
    const rawKey = m[2].trim();
    // A quoted key is a literal we can check; anything else is computed at runtime.
    const literal = /^"([^"]+)"$/.exec(rawKey);
    lookups.push({
      entityType: m[1],
      key: literal ? literal[1] : null,
      file: relative(publicApp, file),
    });
  }
}

const endpointSource = readFileSync(seoEndpoints, "utf8");

function arrayLiteral(source, name) {
  const at = source.indexOf(name);
  assert.notEqual(at, -1, `${name} not found in AdminSeoEndpoints.cs`);
  const open = source.indexOf("[", at);
  const close = source.indexOf("]", open);
  /* Comments are stripped first. These arrays carry explanatory comments that quote page kinds --
     the one above StaticPageKeys names both "page" and "static" -- and reading those as entries
     made this scan report keys that are not keys. */
  const body = source
    .slice(open, close)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const entityTypes = arrayLiteral(endpointSource, "EntityTypes =");
const staticKeys = arrayLiteral(endpointSource, "StaticPageKeys =");

/** The entity types the table itself permits, read from the CHECK constraint. */
const checkSource = readFileSync(migration, "utf8");
const checkBlock = checkSource.slice(
  checkSource.indexOf("page_meta_entity_type_check"),
  checkSource.indexOf("page_meta_static_has_key"),
);
const allowedByCheck = [...checkBlock.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

test("the scan finds both sides of the feature", () => {
  // Guards the guard: with either side empty, every assertion below passes by vacuity.
  assert.ok(pages.length > 20, `only found ${pages.length} public pages`);
  assert.ok(lookups.length >= 8, `only found ${lookups.length} override lookups`);
  assert.ok(staticKeys.length >= 8, `only found ${staticKeys.length} static keys`);
  assert.ok(allowedByCheck.length >= 4, `CHECK parsed as ${JSON.stringify(allowedByCheck)}`);
  assert.deepEqual([...entityTypes].sort(), [...allowedByCheck].sort(),
    "the API's EntityTypes and the table's CHECK must agree");
});

test("every override the public site looks up is one the database can hold", () => {
  const impossible = lookups
    .filter((l) => !allowedByCheck.includes(l.entityType))
    .map((l) => `${l.file} asks for entity_type ${JSON.stringify(l.entityType)}`);

  assert.deepEqual(
    [...new Set(impossible)],
    [],
    "page_meta's CHECK allows " + JSON.stringify(allowedByCheck)
      + ", so these lookups can never match a row:\n  " + [...new Set(impossible)].join("\n  "),
  );
});

test("every static page key the public site reads is one the panel can write", () => {
  const unwritable = lookups
    .filter((l) => l.entityType === "static" && l.key && !staticKeys.includes(l.key))
    .map((l) => `${l.file} reads static/${l.key}`);

  assert.deepEqual(
    [...new Set(unwritable)],
    [],
    "AdminSeoEndpoints.StaticPageKeys does not offer these, so no admin can set them:\n  "
      + [...new Set(unwritable)].join("\n  "),
  );
});

test("every static page key the panel offers is read by a public page", () => {
  const read = new Set(lookups.filter((l) => l.entityType === "static").map((l) => l.key));
  const unread = staticKeys.filter((k) => !read.has(k));

  assert.deepEqual(
    unread,
    [],
    "these keys have a form in the admin panel that saves a row no page ever reads:\n  "
      + unread.join("\n  "),
  );
});

test("every indexable public page sets a canonical URL", () => {
  /* Six did not, the home page among them, so every copy of the URL carrying a tracking parameter
     looked like a separate page to a crawler. Pages that deliberately set noindex are exempt --
     there is nothing to consolidate on a page that is not in the index -- and so are the signed-in
     areas, which are not public at all. */
  const PRIVATE = /[/\\](account|my|onboarding|login)[/\\]/;
  const missing = [];
  for (const file of pages) {
    if (PRIVATE.test(file)) continue;
    const source = readFileSync(file, "utf8");
    if (source.includes("canonical")) continue;
    // A page whose every path sets index:false has nothing to canonicalise.
    if (/robots:\s*(?:applied\.robots\s*\?\?\s*)?\{\s*index:\s*false/.test(source)) continue;
    missing.push(relative(publicApp, file));
  }

  assert.deepEqual(
    missing,
    [],
    "these are indexable and emit no canonical:\n  " + missing.join("\n  "),
  );
});
