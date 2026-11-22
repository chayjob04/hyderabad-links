import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Structured data is written to the page by one component, and that component escapes "<".
 *
 * `JsonLd` exists for this and says so in its own comment. Two other places built the same script
 * tag by hand and left the escape out: the blog post page, and `ListingFaqs` -- which carried a
 * comment arguing it was safe because "the content is plain text from the database and is
 * serialised by JSON.stringify". That is the wrong reason. `JSON.stringify` escapes quotes and
 * backslashes; it does not touch "<" or "/". So an answer containing "</script>" ends the script
 * element -- the HTML parser decides that, not the JSON grammar -- and whatever follows is markup.
 *
 * FAQs are written by business owners through `/api/v1/me`, not by staff, so that string was
 * reachable by anyone who could sign in and claim a listing: stored XSS on a public page.
 */

const here = dirname(fileURLToPath(import.meta.url));
const mainSrc = join(here, "..", "apps", "main-website", "src");
const JSONLD_COMPONENT = join(mainSrc, "components", "JsonLd.tsx");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk(mainSrc);
const emitters = files.filter((f) => readFileSync(f, "utf8").includes("application/ld+json"));

test("the scan reads the public site's components", () => {
  // Guards the guard: an empty walk would make both assertions below pass by vacuity.
  assert.ok(files.length > 40, `only walked ${files.length} files`);
  assert.ok(emitters.length >= 1, "no file emits structured data at all");
});

test("only JsonLd writes a structured-data script tag", () => {
  const offenders = emitters
    .filter((f) => f !== JSONLD_COMPONENT)
    .map((f) => relative(mainSrc, f));

  assert.deepEqual(
    offenders,
    [],
    "these build a <script type=\"application/ld+json\"> by hand instead of using <JsonLd>, "
      + "which is the only place the \"<\" escape lives:\n  " + offenders.join("\n  "),
  );
});

test("JsonLd's own escaping neutralises a closing script tag", () => {
  /* Behavioural, and against the real expression rather than a copy of it: the __html expression is
     read out of the component and evaluated, so if someone drops the .replace() this fails. */
  const source = readFileSync(JSONLD_COMPONENT, "utf8");
  const match = source.match(/__html:\s*(.+?)\s*\}\}/s);
  assert.ok(match, "could not find the __html expression in JsonLd.tsx");

  const render = new Function("data", `return ${match[1]};`);

  const hostile = {
    name: '</script><img src=x onerror="alert(1)">',
    nested: { note: "</SCRIPT ", slash: "</script/>" },
  };
  const html = render(hostile);

  assert.ok(!/<\/script/i.test(html), `escaped output still contains a closing script tag: ${html}`);
  assert.ok(!html.includes("<"), `escaped output still contains a raw "<": ${html}`);
  // Still valid JSON carrying the original text, so the escape did not corrupt the data.
  assert.equal(JSON.parse(html).name, hostile.name);
});
