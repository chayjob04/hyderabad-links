import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The taxonomy is three tiers deep, and every side of the codebase has to agree about it.
 *
 * Segments were added above the existing tree (S0030) rather than renumbered into it, so a category
 * gained a parent where it had none. Three queries decided something from "has this row a parent?"
 * and each one broke in a way that renders perfectly:
 *
 *   - the public category tree returned seven empty segments and no categories at all, which empties
 *     the site's menu, the owner's category picker and both staff pickers;
 *   - the homepage's popular-category cards linked to /food/restaurants-and-food, which is not a
 *     page, because the website builds `/{parentSlug}/{slug}` whenever a parent is present;
 *   - the sitemap left every segment page out, because it asked for rows whose parent was active and
 *     a segment has no parent.
 *
 * None of those fails a build or a typecheck. This test is what notices them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, "..", "backend", "BusinessDirectory.Api");
const migration = join(here, "..", "database", "sqlserver", "migrations", "S0030__category_segments.sql");
const read = (...parts) => readFileSync(join(...parts), "utf8");

/** Source with comments stripped, so prose about a rule is not read as the rule. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the migration makes room for a third tier and keeps the parent rules", () => {
  const sql = read(migration);

  assert.match(sql, /categories_three_levels/, "the new CHECK must be named so it can be found again");
  assert.match(sql, /level = 0 AND parent_id IS NULL/, "a segment is the top: no parent");
  assert.match(sql, /level = 2 AND parent_id IS NOT NULL AND parent_level = 1/, "a subcategory's parent is a category");
  assert.match(sql, /parent_id IS NOT NULL AND parent_level = 0/, "a category's parent is a segment");

  // The old rule has to go, and by lookup rather than by name: production's constraints carry
  // server-generated names (decision D57), which is also what check-migrations.mjs enforces.
  assert.match(sql, /sys\.check_constraints/);
  assert.match(sql, /QUOTENAME/);

  // Nothing in it may remove a category or rewrite a slug.
  assert.doesNotMatch(code(sql), /\bDELETE\s+FROM\s+dbo\.categories\b/i, "this migration must not delete categories");
  /* Anchored on the assignment itself. A looser "SET ... slug =" also matched the UPDATE's own
     join condition (`m.category_slug = c.slug`), which is a comparison rather than a write. */
  assert.doesNotMatch(
    code(sql),
    /(SET|,)\s+(c\.)?slug\s*=/i,
    "this migration must not rename anything",
  );
});

test("the tier numbers in the code are the tier numbers in the database", () => {
  const constants = code(read(api, "Listings", "CategoryTree.cs"));
  const sql = read(migration);

  const value = (name) => {
    const found = constants.match(new RegExp(`${name}\\s*=\\s*(-?\\d+)`));
    assert.ok(found, `${name} must be a plain number in CategoryTree`);
    return Number(found[1]);
  };

  assert.equal(value("SegmentLevel"), 0);
  assert.equal(value("CategoryLevel"), 1);
  assert.equal(value("SubcategoryLevel"), 2);

  // The segment INSERT and the assignment UPDATE both have to use the same number.
  assert.match(sql, /SELECT 0, NULL, NULL, v\.slug/, "segments are inserted at the segment level");
  assert.match(sql, /s\.level = 0/, "categories are assigned to a row at the segment level");
});

test("the public category tree decides a row's tier by its level", () => {
  const source = code(read(api, "Endpoints", "PublicDirectoryEndpoints.cs"));
  /* The handler, not the route table: both names appear there first, a few lines apart. */
  const tree = source.slice(
    source.indexOf("private static async Task<IResult> GetCategories"),
    source.indexOf("private static async Task<IResult> GetSegments"),
  );
  assert.ok(tree.length > 500, "the GetCategories handler should have been found");

  assert.match(tree, /c\.level/, "the query must read the level");
  assert.match(tree, /CategoryTree\.SegmentLevel/);
  assert.match(tree, /CategoryTree\.CategoryLevel/);
  assert.doesNotMatch(
    tree,
    /if \(reader\.IsDBNull\(1\)\)/,
    "deciding the tier from a null parent is what emptied every menu when categories gained segments",
  );
});

test("a popular-category card only gets a parent in its address when it is a subcategory", () => {
  /* The card's URL is `/{parentSlug}/{slug}` when parentSlug is set. A category's parent is its
     segment, which is not in its address, so sending it unconditionally produces a 404. */
  const source = read(api, "Endpoints", "PublicHomepageEndpoints.cs");

  assert.match(
    source,
    /CASE WHEN c\.level = 2 THEN parent\.slug END AS parent_slug/,
    "the parent slug must be guarded by the level",
  );
});

test("the sitemap lists segment pages as well, and does not build them from a missing parent", () => {
  const source = read(api, "Endpoints", "PublicSitemapEndpoints.cs");
  const query = source.slice(source.indexOf("Category pages"), source.indexOf("return Results.Ok"));

  assert.match(query, /c\.parent_id IS NULL OR p\.is_active = 1/, "a segment has no parent to be active");
  assert.match(
    query,
    /CategoryTree\.CategoryLevel/,
    "one path segment deep covers both a segment and a category",
  );
});

test("the admin screen can reach all three tiers", () => {
  const endpoints = code(read(api, "Endpoints", "AdminTaxonomyEndpoints.cs"));

  // Reading, creating, and moving a category between segments. Renaming, reordering, retiring and
  // deleting deliberately reuse the category routes, which work on a row at any tier.
  assert.match(endpoints, /segments\.MapGet\("", ListSegments\)/);
  assert.match(endpoints, /segments\.MapPost\("", CreateSegment\)/);
  assert.match(endpoints, /categories\.MapPut\("\/\{id:int\}\/segment", AssignSegment\)/);

  /* A new row's tier comes from its parent's tier rather than from a hard-coded 1 or 2 -- the
     endpoint reads the parent's level, and the one INSERT that every path goes through derives
     parent_level from it. The INSERT moved to TaxonomyWriter when approving an owner's request
     became a second way to add a category (S0032), so the rule is asserted where it now lives. */
  assert.match(endpoints, /parentLevel == CategoryTree\.SegmentLevel/);
  assert.doesNotMatch(
    endpoints,
    /level = 2;/,
    "the tier of a new row is decided by what it is created under, not assigned",
  );

  const writer = code(read(api, "Listings", "TaxonomyWriter.cs"));
  assert.match(writer, /CategoryTree\.ParentLevelFor\(level\)/);

  // And there is one INSERT per table, not one per screen.
  for (const [table, source] of [
    ["dbo.categories", endpoints],
    ["dbo.localities", endpoints],
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`INSERT INTO ${table.replace(".", "\\.")}`),
      `${table} is written through TaxonomyWriter, so this file should not insert into it`,
    );
  }
});

test("the owner's pickers show the segment a category belongs to", () => {
  const main = join(here, "..", "apps", "main-website", "src");
  const onboarding = code(readFileSync(join(main, "app", "onboarding", "OnboardingForm.tsx"), "utf8"));
  const listingForm = code(readFileSync(join(main, "components", "ListingForm.tsx"), "utf8"));

  assert.match(onboarding, /parent\.segmentName/, "the searchable hint names the segment");
  assert.match(listingForm, /parent\.segmentName/, "the category group names the segment");
});
