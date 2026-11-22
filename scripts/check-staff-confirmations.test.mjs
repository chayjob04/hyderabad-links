import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nothing destructive on the staff site acts on a single click.
 *
 * All twelve destructive controls -- delete a category, locality, shelf, listing, FAQ, content
 * section, link, synonym, example search or scrolling line; archive a listing; take one off the
 * Featured shelf -- were a lone `<button type="submit">` inside a form wired straight to the server
 * action. The API's own rules are the real safeguard and they are good ones (a listing that has
 * ever been paid for cannot be deleted; a category something points at cannot be either), but a
 * rule that refuses the wrong deletions does nothing about the right one done by accident, and
 * "Delete" sits two buttons from "Switch off".
 *
 * They now go through <ConfirmButton>. This file pins that arrangement. The dialog's own behaviour
 * -- that the first click sends no request, that Escape and Cancel send none either, and that
 * Confirm sends exactly one -- needs a browser and was verified in one; what these tests catch is
 * a thirteenth destructive action added with a bare button, which is how the first twelve happened.
 */

const here = dirname(fileURLToPath(import.meta.url));
const staffSrc = join(here, "..", "apps", "staff-website", "src");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(staffSrc);
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/** Destructive server actions, by name. */
const destructive = [];
for (const [, source] of sources) {
  if (!source.includes('"use server"')) continue;
  for (const m of source.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
    if (/^(delete|remove|archive)/i.test(m[1])) destructive.push(m[1]);
  }
}

/** The markup of the form that binds `action`, found without a built regex. */
function formsBinding(action) {
  const found = [];
  for (const [file, source] of sources) {
    if (/actions\.ts$|-actions\.ts$|-state\.ts$/.test(basename(file))) continue;
    let from = 0;
    for (;;) {
      const at = source.indexOf(`${action}.bind(`, from);
      if (at === -1) break;
      from = at + 1;
      const open = source.lastIndexOf("<form", at);
      const close = source.indexOf("</form>", at);
      if (open === -1 || close === -1) continue;
      found.push({ file: basename(file), markup: source.slice(open, close) });
    }
  }
  return found;
}

test("the scan finds the destructive actions and their call sites", () => {
  // Guards the guard: an empty list would make the assertions below pass by vacuity.
  assert.ok(files.length > 40, `only walked ${files.length} staff files`);
  assert.ok(
    destructive.length >= 12,
    `expected at least 12 destructive actions, found ${destructive.length}: ${destructive.join(", ")}`,
  );
  const bound = destructive.filter((a) => formsBinding(a).length > 0);
  assert.ok(
    bound.length >= 12,
    `only located call sites for ${bound.length} of ${destructive.length}: ${bound.join(", ")}`,
  );
});

test("every destructive control asks before it acts", () => {
  const unconfirmed = [];
  for (const action of destructive) {
    for (const { file, markup } of formsBinding(action)) {
      if (!markup.includes("<ConfirmButton")) unconfirmed.push(`${action} in ${file}`);
    }
  }

  assert.deepEqual(
    [...new Set(unconfirmed)],
    [],
    "these destructive controls act on one click, with no confirmation:\n  "
      + [...new Set(unconfirmed)].join("\n  "),
  );
});

test("each confirmation names the act and the record", () => {
  /* "Are you sure?" with an OK button is a dialog people learn to dismiss without reading. Each of
     these has to say what it will do and to which record, so the one that is open can be told
     apart from the one that was meant. */
  const thin = [];
  for (const action of destructive) {
    for (const { file, markup } of formsBinding(action)) {
      const at = markup.indexOf("<ConfirmButton");
      if (at === -1) continue;
      const props = markup.slice(at, markup.indexOf(">", at) === -1 ? undefined : markup.length);
      if (!/title="[^"]*\?"/.test(props)) thin.push(`${action} in ${file}: title is not a question`);
      if (!/subject=\{/.test(props)) thin.push(`${action} in ${file}: does not name the record`);
      if (!/confirmLabel="/.test(props)) thin.push(`${action} in ${file}: confirm button is unlabelled`);
    }
  }

  assert.deepEqual([...new Set(thin)], [], [...new Set(thin)].join("\n  "));
});

test("the confirmation cancels the submit it is attached to", () => {
  /* The trigger is a real type="submit", so the control still works if the script never arrives.
     That is only safe because the submit is cancelled to open the dialog: without the
     preventDefault the first click would delete and then show a dialog, which is worse than no
     dialog at all. The alternative -- type="button" -- would make all twelve dead controls without
     JavaScript, which is the failure the sibling controls test exists for. */
  const source = readFileSync(join(staffSrc, "components", "ConfirmButton.tsx"), "utf8");

  const onClick = source.match(/onClick=\{\(event\) => \{([\s\S]*?)\n\s*\}\}/);
  assert.ok(onClick, "ConfirmButton's trigger no longer has an onClick handler");
  assert.match(onClick[1], /event\.preventDefault\(\)/, "the trigger must cancel its own submit");
  assert.match(onClick[1], /showModal\(\)/, "the trigger must open the dialog as a modal");

  assert.match(source, /type="submit"/, "the trigger must stay a submit button");
  assert.match(source, /useFormStatus/, "the buttons must disable while the action runs");
  /* Cancel must not be a submit: inside a form, a button with no type submits it. Read the Cancel
     element itself rather than searching the file, because the comment above it says
     `type="button"` too and a search would match that after the attribute was gone. */
  const cancelAt = source.indexOf(">\n            Cancel");
  assert.notEqual(cancelAt, -1, "could not find the Cancel button in ConfirmButton.tsx");
  const cancelTag = source.slice(source.lastIndexOf("<button", cancelAt), cancelAt);
  assert.match(
    cancelTag,
    /type="button"/,
    'Cancel must be type="button", or it submits the form it sits in: ' + JSON.stringify(cancelTag),
  );
});
