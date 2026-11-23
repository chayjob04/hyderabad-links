import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * An edit to a published listing is staged, and the published version is left alone.
 *
 * This is the feature with the quietest failure mode in the project: if the update handler ever
 * writes a published listing's edit straight through again, everything still works — the owner
 * saves, the message appears, the moderator sees a queue — except that the business comes off the
 * site while it waits, which is exactly what S0031 was built to stop. Nothing fails, so this is
 * what notices.
 */

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, "..", "backend", "BusinessDirectory.Api");
const mainSrc = join(here, "..", "apps", "main-website", "src");
const staffSrc = join(here, "..", "apps", "staff-website", "src");
const read = (...parts) => readFileSync(join(...parts), "utf8");

/** Source with comments stripped, so prose about a rule is not read as the rule. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the migration gives a staged edit one row per listing and a state it cannot lie about", () => {
  const sql = read(here, "..", "database", "sqlserver", "migrations", "S0031__listing_pending_changes.sql");

  assert.match(sql, /CREATE TABLE dbo\.listing_pending_changes/);
  assert.match(sql, /listing_pending_changes_listing_key UNIQUE \(listing_id\)/, "one staged edit per listing");
  assert.match(sql, /status IN \('draft', 'pending_review', 'rejected'\)/, "three states and no more");
  assert.match(sql, /ON DELETE CASCADE/, "a deleted listing takes its staged edit with it");
  assert.match(sql, /listing_pending_changes_submitted_check/, "a submitted edit carries its date");
  assert.match(sql, /listing_pending_changes_rejection_check/, "a rejection carries its reason");

  // It creates a table. It must not touch a listing.
  assert.doesNotMatch(code(sql), /UPDATE\s+dbo\.listings/i, "this migration must not write to listings");
  assert.doesNotMatch(code(sql), /DELETE\s+FROM\s+dbo\.listings/i);
});

test("the owner's update stages an edit to a published listing instead of writing it", () => {
  const source = read(api, "Endpoints", "OwnerListingEndpoints.cs");
  const update = source.slice(
    source.indexOf("private static async Task<IResult> Update"),
    source.indexOf("// ------------------------------------------------------------------ submit for review"),
  );
  assert.ok(update.length > 1000, "the Update handler should have been found");

  // The branch, and the order: the staged path returns before anything writes to the listing.
  const staged = update.indexOf("PendingChanges.IsPublished");
  const written = update.indexOf("ListingWriter.UpdateListing");
  assert.ok(staged > 0, "the handler must ask whether the listing is published");
  assert.ok(written > staged, "the staged path must come first and return");
  assert.match(update.slice(staged, written), /PendingChanges\.UpsertAsync/);
  assert.match(update.slice(staged, written), /return Results\.Ok/);
});

test("approving publishes the edit and rejecting leaves the listing alone", () => {
  const source = code(read(api, "Endpoints", "AdminPendingChangeEndpoints.cs"));

  // Approve applies and clears; reject writes only to the staged row.
  const approve = source.slice(source.indexOf("Task<IResult> Approve"), source.indexOf("Task<IResult> Reject"));
  assert.match(approve, /PendingChanges\.ApplyAsync/);
  assert.match(approve, /listing\.changes_approved/, "the decision is in the audit log");

  const reject = source.slice(source.indexOf("Task<IResult> Reject"));
  assert.match(reject, /PendingChanges\.RejectAsync/);
  assert.doesNotMatch(reject, /ApplyAsync|UPDATE\s+dbo\.listings/i, "a refusal must not touch the listing");

  // Both decisions take the row's lock first, so two moderators cannot both decide one.
  assert.match(source, /UPDLOCK, HOLDLOCK, ROWLOCK/);
  assert.equal((source.match(/LockStaged\(conn, tx, listingId, ct\)/g) ?? []).length, 2);
});

test("applying a staged edit never changes the listing's status", () => {
  /* The listing was published before the edit and is published after it. A status write here would
     put a live business back in the queue, which is the behaviour this replaced. */
  const apply = code(read(api, "Listings", "PendingChanges.cs"));
  const body = apply.slice(apply.indexOf("ApplyAsync"), apply.indexOf("RejectAsync"));

  assert.match(body, /UPDATE dbo\.listings SET/);
  assert.doesNotMatch(body, /status\s*=/, "applying an edit must not touch the listing's status");
});

test("the owner's editor shows the staged values, not the published ones", () => {
  const editor = read(mainSrc, "app", "account", "listings", "[id]", "edit", "page.tsx");

  assert.match(editor, /listing\.pendingChanges \?\? null/);
  assert.match(editor, /initialValues=\{\{[\s\S]*?name: shown\.name/, "the form is filled from what the owner typed");
  assert.match(editor, /describePendingChanges/, "and the page says which version the public sees");
  assert.match(editor, /discardChangesAction/, "with a way to throw the edit away");
});

test("the save message tells the owner the public page did not change", () => {
  const actions = code(read(mainSrc, "app", "account", "actions.ts"));

  assert.match(actions, /result\.data\.pendingChanges/, "the message follows what the API did");
  assert.match(actions, /stays on the site as it is/);
});

test("the staff queue is behind the same permission as the listing queue", () => {
  const client = code(read(staffSrc, "lib", "admin-api.ts"));
  const page = code(read(staffSrc, "app", "admin", "listing-changes", "page.tsx"));
  const endpoints = code(read(api, "Endpoints", "AdminPendingChangeEndpoints.cs"));

  assert.match(client, /PERMISSION_REVIEW_CHANGES = "listings\.review"/);
  assert.match(page, /PERMISSION_REVIEW_CHANGES/);
  assert.match(endpoints, /AdminPermissions\.ListingsReview/, "the API is the control, not the screen");
});
