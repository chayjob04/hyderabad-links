import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The owner's listing editor: where the two actions live, and what they carry.
 *
 * Save Changes and Submit for Review used to be inside the "Business details" accordion, because
 * that is the one section with a form of its own. They are now at the foot of the editor, outside
 * every `<details>`, reaching the fields through the form's id. That arrangement is easy to undo by
 * accident -- moving the buttons back inside the section, or dropping the id -- and it would not
 * fail a typecheck or a build, so it is asserted here.
 *
 * The last test is about a different mistake with the same shape: a server action importing a value
 * from a `"use client"` module. It type-checks, it builds, and at runtime the server gets a client
 * reference instead of the value. That is how the onboarding form came to send `__other__` to the
 * API as though it were an area slug -- the guard compared against something that was not the
 * string any more.
 */

const here = dirname(fileURLToPath(import.meta.url));
const mainSrc = join(here, "..", "apps", "main-website", "src");
const staffSrc = join(here, "..", "apps", "staff-website", "src");
const read = (...parts) => readFileSync(join(mainSrc, ...parts), "utf8");

/** Source with comments stripped, so prose about a thing is not read as the thing. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const EDITOR = "components/account/ListingEditor.tsx";

test("the action area is not inside an accordion", () => {
  /* The buttons live in ListingEditor, which renders them after `{children}` -- the sections -- and
     contains no `<details>` of its own. If the two ever end up in the same file, this is the test
     that notices. */
  const editor = code(read(EDITOR));

  assert.match(editor, /form=\{DETAILS_FORM_ID\}/, "the buttons must target the fields' form by id");
  assert.equal(
    (editor.match(/form=\{DETAILS_FORM_ID\}/g) ?? []).length,
    2,
    "both Save and Submit must target that form",
  );
  assert.doesNotMatch(editor, /<details/, "the action area must not be inside an accordion");
  assert.match(editor, /\{children\}/, "the sections are rendered above the action area");
});

test("both actions are in the editor, and only there", () => {
  const editor = read(EDITOR);
  assert.match(editor, /Save changes/);
  assert.match(editor, /Submit for review/);

  // No other owner screen may grow its own copy of either button.
  const offenders = [];
  for (const file of walk(join(mainSrc, "app", "account"))) {
    const text = code(readFileSync(file, "utf8"));
    if (/<button[\s\S]{0,400}?Submit for review/.test(text)) offenders.push(relative(mainSrc, file));
  }
  assert.deepEqual(offenders, [], "a second Submit button would be a second implementation");
});

test("which button was pressed travels in a hidden field, not the submitter", () => {
  /* A button outside its form is still the submitter, but whether its name and value reach the
     action depends on the browser supporting `new FormData(form, submitter)`. Submit being
     quietly treated as Save is the worst way for that to fail. */
  const form = code(read("components/ListingForm.tsx"));
  assert.match(form, /type="hidden"\s+name="intent"\s+defaultValue="save"/);
  assert.doesNotMatch(form, /<button/, "the fields' form holds no buttons of its own");
  assert.match(form, /id=\{formId\}/, "the form carries the id the buttons target");

  const actions = code(read("app", "account", "actions.ts"));
  assert.match(actions, /formData\.get\("intent"\) === "submit"/);
});

test("a new listing is created as a draft and continues in the editor", () => {
  const actions = code(read("app", "account", "actions.ts"));
  assert.match(actions, /\/account\/listings\/\$\{result\.data\.id\}\/edit\?created=1/);
  assert.match(actions, /\/account\/listings\?submitted=1/);
});

test("the Saved / what to do next page is gone", () => {
  assert.equal(
    existsSync(join(mainSrc, "app", "account", "listings", "[id]", "created")),
    false,
    "the post-creation page was removed; nothing should recreate it",
  );

  const offenders = [];
  for (const file of walk(join(mainSrc))) {
    const text = code(readFileSync(file, "utf8"));
    if (/listings\/[^"'`]*\/created/.test(text)) offenders.push(relative(mainSrc, file));
  }
  assert.deepEqual(offenders, [], "these still link to the page that was removed");
});

test("the editor names a section for every field a submission can be refused over", () => {
  const page = code(read("app", "account", "listings", "[id]", "edit", "page.tsx"));
  // The two fields the API gates review on, which is what the action area points the owner at.
  for (const field of ["addressLine", "description"]) {
    assert.match(page, new RegExp(`${field}: SECTION\\.`), `${field} must map to a section`);
  }
  assert.match(page, /fieldSections=\{FIELD_SECTIONS\}/);
});

test("no server action imports a value from a client module", () => {
  /* Both sides compile and the build passes; the server simply does not get the value. The one
     import this caught was a shared constant, so the fix was a plain module both sides can read.

     Both websites, because the mistake is not specific to either: the staff site has as many
     server actions as the public one, and the same `@/` alias to resolve them through. */
  const offenders = [];
  let serverFiles = 0;

  for (const src of [mainSrc, staffSrc]) {
    for (const file of walk(src)) {
      const text = readFileSync(file, "utf8");
      if (!/^\s*(["'])use server\1/.test(text)) continue;
      serverFiles += 1;

      for (const match of text.matchAll(/^import\s+(?!type\b)([\s\S]*?)from\s+"([^"]+)"/gm)) {
        const [, clause, from] = match;
        if (!from.startsWith("@/") && !from.startsWith(".")) continue;
        if (/^\{\s*type\s/.test(clause.trim())) continue; // import { type X } from ...
        const base = from.startsWith("@/") ? join(src, from.slice(2)) : resolve(dirname(file), from);
        const target = [".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext).find(existsSync);
        if (!target) continue;
        if (/^\s*(["'])use client\1/.test(readFileSync(target, "utf8"))) {
          offenders.push(`${relative(src, file)} imports ${clause.trim()} from ${from}`);
        }
      }
    }
  }

  assert.ok(serverFiles >= 10, `expected to find both sites' server actions, found ${serverFiles}`);
  assert.deepEqual(offenders, [], "a server action cannot read a value out of a client module");
});
