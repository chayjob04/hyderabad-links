import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The section percentages in the listing editor are counted, not written down.
 *
 * They replace the "check what's missing" screen, which listed the same gaps on a page of its own,
 * away from the fields it was talking about. The arithmetic is worth testing because a completion
 * figure is the kind of thing that gets faked: a hardcoded 60%, or a bar that fills as sections are
 * opened, looks right in a screenshot and tells an owner nothing.
 *
 * The module under test is plain TypeScript with no imports, so it is compiled here with a small
 * transform rather than pulled in through a bundler.
 */

const here = dirname(fileURLToPath(import.meta.url));
const mainSrc = join(here, "..", "apps", "main-website", "src");
const modulePath = join(mainSrc, "lib", "listing-completion.ts");

/** The module's runtime, with the type-only syntax removed. */
async function load() {
  const source = readFileSync(modulePath, "utf8")
    .replace(/^export type [\s\S]*?^};$/gm, "")          // exported type aliases
    .replace(/:\s*readonly CompletionField\[\]/g, "")
    .replace(/:\s*readonly SectionCompletion\[\]/g, "")
    .replace(/:\s*SectionCompletion\b/g, "")
    .replace(/:\s*string \| null \| undefined/g, "")
    .replace(/:\s*number\b/g, "")
    .replace(/:\s*boolean\b/g, "");
  return await import(`data:text/javascript,${encodeURIComponent(source)}`);
}

const { completionOf, overallCompletion, filled, filledTo } = await load();

test("an empty section is 0% and names everything it wants", () => {
  const section = completionOf([
    { label: "address", done: false },
    { label: "description", done: false },
  ]);

  assert.equal(section.percent, 0);
  assert.equal(section.filled, 0);
  assert.equal(section.total, 2);
  assert.deepEqual(section.missing, ["address", "description"]);
});

test("a full section is 100% and names nothing", () => {
  const section = completionOf([
    { label: "address", done: true },
    { label: "description", done: true },
  ]);

  assert.equal(section.percent, 100);
  assert.deepEqual(section.missing, []);
});

test("the percentage is the fraction actually filled in", () => {
  assert.equal(completionOf([{ label: "a", done: true }, { label: "b", done: false }]).percent, 50);
  assert.equal(
    completionOf([
      { label: "a", done: true },
      { label: "b", done: true },
      { label: "c", done: false },
    ]).percent,
    67,
  );
});

test("an optional field moves nothing, filled or empty", () => {
  /* Otherwise a listing could never reach 100% without a WhatsApp number, and a section would jump
     when somebody added one -- neither of which is what "complete" is being asked. */
  const withoutIt = completionOf([
    { label: "address", done: true },
    { label: "whatsapp", done: false, optional: true },
  ]);
  const withIt = completionOf([
    { label: "address", done: true },
    { label: "whatsapp", done: true, optional: true },
  ]);

  assert.equal(withoutIt.percent, 100);
  assert.equal(withIt.percent, 100);
  assert.deepEqual(withoutIt.missing, []);
  assert.equal(withoutIt.total, 1);
});

test("a section that asks for nothing is complete, not a division by zero", () => {
  // Photos on a free plan: the feature is not part of the plan, so there is nothing outstanding.
  const section = completionOf([]);

  assert.equal(section.percent, 100);
  assert.equal(section.total, 0);
  assert.deepEqual(section.missing, []);
});

test("the overall figure is the sections added up, so the two cannot disagree", () => {
  const details = completionOf([
    { label: "address", done: true },
    { label: "description", done: false },
  ]);
  const hours = completionOf([{ label: "opening hours", done: true }]);
  const photos = completionOf([]); // free plan

  const overall = overallCompletion([details, hours, photos]);

  assert.equal(overall.filled, 2);
  assert.equal(overall.total, 3);
  assert.equal(overall.percent, 67);
  assert.deepEqual(overall.missing, ["description"]);
});

test("a field is counted once, in its own section", () => {
  /* Summing the sections rather than recounting the fields is what guarantees this: a field has one
     section, so it contributes one unit to the total. */
  const one = completionOf([{ label: "address", done: true }]);
  const overall = overallCompletion([one, one, one]);

  assert.equal(overall.total, 3);
  assert.equal(overall.filled, 3);
});

test("whitespace is not an answer", () => {
  assert.equal(filled("Garden Cafe"), true);
  assert.equal(filled("   "), false);
  assert.equal(filled(""), false);
  assert.equal(filled(null), false);
  assert.equal(filled(undefined), false);
});

test("a description has to be long enough to count", () => {
  // The same 20 characters ListingReadiness gates Submit on, so the section reading 100% and
  // Submit being accepted are the same statement.
  assert.equal(filledTo("Too short", 20), false);
  assert.equal(filledTo("A quiet courtyard cafe serving filter coffee.", 20), true);
  assert.equal(filledTo("                        ", 20), false);
});

test("no editor section writes its own percentage", () => {
  /* The guard against the easy version of this feature. Every figure has to come from
     completionOf/overallCompletion, so a literal percent in one of these files is a finding. */
  function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  const offenders = [];
  for (const file of walk(join(mainSrc, "app", "account"))) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("ListingSection")) continue;
    // percent={...} must be computed, and completion must come from the helpers.
    if (/percent[=:]\s*\{?\s*\d/.test(source)) offenders.push(relative(mainSrc, file));
    if (/completion=\{\{/.test(source)) offenders.push(relative(mainSrc, file));
  }

  assert.deepEqual(
    [...new Set(offenders)],
    [],
    "these write a completion figure by hand instead of counting it:\n  " + offenders.join("\n  "),
  );
});
