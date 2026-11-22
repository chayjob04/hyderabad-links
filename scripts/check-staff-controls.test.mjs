import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every server action in the staff app is reachable from the interface.
 *
 * A server action nobody binds is a feature with no way in, and it looks finished from every angle:
 * the endpoint answers, the client call is written, the action compiles, the tests pass. The only
 * thing missing is a control, and nothing notices an absence.
 *
 * `moveToGroupAction` was exactly that. It called a working, permission-gated endpoint that moves a
 * featured listing between homepage shelves, and no form in the app bound it -- so a super admin
 * could create a named shelf, rename it and delete it, but never put a listing on one. Every
 * featured listing stayed on the default strip and the public `/groups/<slug>` pages could only
 * ever be empty. The shelf count rendered beside each shelf could only ever read zero.
 */

const here = dirname(fileURLToPath(import.meta.url));
const staffSrc = join(here, "..", "apps", "staff-website", "src");

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

const files = walk(staffSrc);
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const everything = [...sources.values()].join("\n");

/** Exported server actions, by name, with the file that declares each. */
const actions = new Map();
for (const [file, source] of sources) {
  if (!source.includes('"use server"')) continue;
  for (const match of source.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
    actions.set(match[1], basename(file));
  }
}

test("the scan finds the staff app's server actions", () => {
  // Guards the guard: an empty set would make the assertion below pass by vacuity.
  assert.ok(files.length > 40, `only walked ${files.length} staff files`);
  assert.ok(actions.size > 30, `only found ${actions.size} server actions`);
});

test("every server action is referenced somewhere in the app", () => {
  const unreferenced = [];
  for (const [name, file] of actions) {
    // Its own declaration is one occurrence; a binding anywhere is a second.
    const occurrences = everything.split(new RegExp(`\\b${name}\\b`)).length - 1;
    if (occurrences <= 1) unreferenced.push(`${name} (${file})`);
  }

  assert.deepEqual(
    unreferenced,
    [],
    `these server actions are declared and never bound to a control:\n  ${unreferenced.join("\n  ")}`,
  );
});

test("every API client function is called from outside the client library", () => {
  /* The same absence one layer down: a client call nothing uses means an endpoint the interface
     cannot reach. Reported as a list rather than asserted empty, because one is known and
     deliberate -- listAdmins was superseded by the paged listAdminPage and its endpoint still
     exists. Anything joining it should be a decision, not an accident. */
  const libs = ["admin-api.ts", "super-admin-api.ts"];
  const clientNames = new Set();
  for (const [file, source] of sources) {
    if (!libs.includes(basename(file))) continue;
    for (const match of source.matchAll(/export\s+(?:const|async\s+function)\s+([a-z]\w+)/g)) {
      clientNames.add(match[1]);
    }
  }

  const consumers = [...sources.entries()]
    .filter(([file]) => !libs.includes(basename(file)))
    .map(([, source]) => source)
    .join("\n");

  const uncalled = [...clientNames].filter((name) => !new RegExp(`\\b${name}\\b`).test(consumers)).sort();

  assert.deepEqual(
    uncalled,
    ["listAdmins"],
    `the set of uncalled client functions changed:\n  ${uncalled.join("\n  ")}\n`
      + "If one was added, it is an endpoint the interface cannot reach. If one was removed, update this list.",
  );
});

test("no staff page passes an event handler from a server component", () => {
  /* A React Server Component cannot carry onChange or onClick: the build refuses it. I wrote one
     into the Featured screen while adding the shelf picker and the typecheck caught it, so this
     records the rule rather than relying on being caught again. Only files WITHOUT "use client"
     are checked; a client component may of course have handlers. */
  const offenders = [];
  for (const [file, source] of sources) {
    if (source.includes('"use client"')) continue;
    if (/\son(?:Change|Click|Submit|Input|Blur|Focus)\s*=\s*\{/.test(source)) {
      offenders.push(basename(file));
    }
  }

  assert.deepEqual(offenders, [], `server components with event handlers: ${offenders.join(", ")}`);
});
