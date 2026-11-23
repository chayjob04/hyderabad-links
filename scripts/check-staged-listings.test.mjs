import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A whole listing is staged, and a staged listing can never be seen or counted as a business.
 *
 * This replaces check-pending-changes.test.mjs, which pinned an earlier design: a table of eight
 * columns that staged the Business details form only. S0034 stages the listing itself -- a real row
 * in `listings` with `staged_for_listing_id` set, holding its own photos, hours, questions, content,
 * amenities and links -- because the other four sections could not be staged in that table without
 * a parallel copy of five more.
 *
 * That design buys a great deal and costs one thing: **every list, count and queue of listings now
 * has a row in it that is not a business.** Forgetting one of them does not fail a build, a
 * typecheck or any test that does not know to look -- it shows somebody a second copy of their own
 * shop, or tells them they are at the five-listing limit when they have three. So the checklist is
 * here, and it fails when a query loses its filter.
 */

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, "..", "backend", "BusinessDirectory.Api");
const mainSrc = join(here, "..", "apps", "main-website", "src");
const staffSrc = join(here, "..", "apps", "staff-website", "src");
const read = (...parts) => readFileSync(join(...parts), "utf8");

/** Source with comments stripped, so prose about a rule is not read as the rule. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** The same for SQL, whose comments start with two dashes. */
const sqlCode = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

test("the migration makes a staged listing impossible to publish by accident", () => {
  const sql = read(here, "..", "database", "sqlserver", "migrations", "S0034__listing_staging.sql");

  assert.match(sql, /ADD staged_for_listing_id bigint NULL/);
  assert.match(sql, /ADD is_placeholder bit NOT NULL/);

  /* The constraint that does the work of six query filters: a staged row cannot hold the status
     every public query requires, so no public query can serve one -- including one written later
     by somebody who has never heard of the column. */
  assert.match(sql, /listings_staged_not_active/);
  assert.match(sql, /staged_for_listing_id IS NULL OR status <> 'active'/);

  // One edit per listing, one unsaved new listing per owner, both as filtered unique indexes.
  assert.match(sql, /CREATE UNIQUE INDEX listings_staged_for_key[\s\S]{0,200}WHERE staged_for_listing_id IS NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX listings_placeholder_per_owner_key[\s\S]{0,200}WHERE is_placeholder = 1/);

  // A staged listing inherits its parent's plan, or its owner is asked to pay for photos they have.
  assert.match(sql, /COALESCE\(li\.staged_for_listing_id, li\.id\)/);

  // It must not touch a published listing, or any media, payment or audit row.
  assert.doesNotMatch(sqlCode(sql), /DELETE\s+FROM\s+dbo\.listing_media/i);
  assert.doesNotMatch(sqlCode(sql), /UPDATE\s+dbo\.listings\s+SET/i);
});

test("every list, count and queue of listings skips the staged rows", () => {
  /* The checklist. Each entry is a query that answers "which listings are there?" for somebody --
     an owner, a moderator, the platform owner -- and each would quietly include a staged copy or an
     unsaved new listing without its filter. */
  const sites = [
    ["Endpoints/OwnerListingEndpoints.cs", "the owner's own list and their five-listing limit", 2],
    ["Endpoints/OwnerOverviewEndpoints.cs", "the owner's dashboard figures", 1],
    ["Endpoints/OwnerSubscriptionEndpoints.cs", "every listing's plan", 1],
    ["Endpoints/AdminListingEndpoints.cs", "the moderation queue", 1],
    ["Endpoints/SuperAdminListingEndpoints.cs", "the directory list", 1],
    ["Endpoints/SuperAdminEndpoints.cs", "the super-admin dashboard counts", 1],
    ["Endpoints/SuperAdminSubscriptionEndpoints.cs", "the subscription report and its figures", 5],
    ["Endpoints/SuperAdminDirectoryEndpoints.cs", "how many listings each owner has", 2],
    ["Endpoints/AdminSeoEndpoints.cs", "the SEO listing picker", 1],
    ["Endpoints/AdminTaxonomyEndpoints.cs", "listings counted against a category", 1],
  ];

  for (const [file, what, atLeast] of sites) {
    const source = code(read(api, ...file.split("/")));
    const mentions = (source.match(/staged_for_listing_id IS NULL/g) ?? []).length;
    assert.ok(
      mentions >= atLeast,
      `${what} (${file}) should exclude staged listings in ${atLeast} place(s); found ${mentions}`,
    );
  }
});

test("a published listing is never written to by the owner's update", () => {
  const source = read(api, "Endpoints", "OwnerListingEndpoints.cs");
  const update = source.slice(
    source.indexOf("private static async Task<IResult> Update"),
    source.indexOf("// ------------------------------------------------------------------ submit for review"),
  );
  assert.ok(update.length > 1000, "the Update handler should have been found");

  /* It refuses, rather than redirecting the write to the staged copy. An owner's save has to land
     where their screen says it landed, and a client that has not been told about staging should be
     told rather than quietly rerouted. */
  const refusal = update.indexOf('currentStatus == "active"');
  const write = update.indexOf("ListingWriter.UpdateListing");
  assert.ok(refusal > 0, "the handler must check whether the listing is on the site");
  assert.ok(write > refusal, "and refuse before anything is written");
  assert.match(update.slice(refusal, write), /Status409Conflict/);
});

test("every section's writes are refused on a published listing, by a filter and not by hope", () => {
  /* Photos, opening hours, questions, content, amenities and links each have their own endpoints,
     and each used to publish immediately -- which is the inconsistency this change removes. The
     guard is a filter on the route so that the next endpoint added to one of these files is covered
     without anybody remembering. */
  const guard = code(read(api, "Listings", "StagedWrites.cs"));
  assert.match(guard, /status = 'active'/);
  assert.match(guard, /IsGet\(method\)/, "reads must pass through");
  assert.match(guard, /Status409Conflict/);

  for (const file of [
    "OwnerMediaEndpoints.cs",
    "OwnerLinkEndpoints.cs",
    "OwnerOpeningHoursEndpoints.cs",
    "OwnerListingContentEndpoints.cs",
    "OwnerAttributeEndpoints.cs",
  ]) {
    assert.match(
      code(read(api, "Endpoints", file)),
      /RefuseWritesToPublishedListings\(\)/,
      `${file} must refuse writes to a published listing`,
    );
  }
});

test("a new listing's area can still be chosen, and a published one's cannot", () => {
  /* A placeholder is created in the area of the owner's first listing, because a row needs one
     before the owner has said anything. Without a way to change it afterwards, every second
     business an owner adds would be filed under the first one's area for good. */
  const endpoints = code(read(api, "Endpoints", "OwnerListingEndpoints.cs"));
  assert.match(endpoints, /mayChooseArea\s*=\s*neverPublic\s*&&\s*!lockResult\.Value\.Staged/);
  assert.match(endpoints, /ListingWriter\.MoveToLocality\(/);

  // The lock reads both facts the rule needs, so neither is a second query that could disagree.
  assert.match(endpoints, /staged_for_listing_id IS NULL THEN 0 ELSE 1/);

  const writer = code(read(api, "Listings", "ListingWriter.cs"));
  assert.match(writer, /UPDATE dbo\.listings SET locality_id = @locality WHERE id = @id/);

  // And the editor draws the select only for a listing no moderator has seen.
  const editor = read(mainSrc, "app", "account", "listings", "[id]", "edit", "page.tsx");
  assert.match(editor, /mayChooseArea = !isCopy && \(listing\.status === "draft" \|\| listing\.status === "rejected"\)/);
  assert.match(editor, /mayChooseArea && localities \?/);
  assert.match(editor, /lockedLocalityName=\{listing\.localityName\}/);

  // And the save actually carries it. It used to be stripped out of the request on purpose.
  const ownerApi = read(mainSrc, 'lib', 'owner-api.ts');
  assert.ok(!/localitySlug: undefined/.test(ownerApi), 'the area is stripped out of the save again');
});

test("a staged copy cannot buy a plan of its own", () => {
  /* It is deleted when the edit is approved, and its entitlement is read from the listing it stands
     in for -- so a payment taken for it would be a payment for a row that is about to disappear. */
  const subscriptions = code(read(api, "Endpoints", "OwnerSubscriptionEndpoints.cs"));
  assert.match(subscriptions, /RefuseStagedListings\(\)/);

  const guard = code(read(api, "Listings", "StagedWrites.cs"));
  assert.match(guard, /staged_for_listing_id IS NOT NULL/);

  // And the owner's editor points Promote, Ads and Plan at the listing rather than at the copy.
  const editor = read(mainSrc, "app", "account", "listings", "[id]", "edit", "page.tsx");
  assert.match(editor, /listingId=\{listing\.stagedForListingId \?\? listing\.id\}/);
});

test("approving moves every section, and never changes what a listing is", () => {
  const staged = code(read(api, "Listings", "StagedListings.cs"));

  // All seven child tables are named in one list, so the copy, the move and the delete agree.
  for (const table of [
    "dbo.listing_categories",
    "dbo.listing_media",
    "dbo.listing_opening_hours",
    "dbo.listing_faqs",
    "dbo.listing_content_sections",
    "dbo.listing_attributes",
    "dbo.listing_links",
  ]) {
    assert.ok(staged.includes(table), `${table} must be part of a staged listing`);
  }

  const approve = staged.slice(staged.indexOf("ApproveAsync"), staged.indexOf("RejectAsync"));

  // The published row keeps its status and its slug: it was on the site before and after, and its
  // address is what every link to it uses.
  assert.doesNotMatch(approve, /SET[\s\S]{0,400}?status =/, "approving must not change the status");
  assert.doesNotMatch(approve, /slug =/, "approving must not change the slug");

  // Children are moved rather than copied, so no file is re-uploaded and no URL changes.
  assert.match(approve, /SET listing_id = @published WHERE listing_id = @staged/);
  // And the staged row goes.
  assert.match(approve, /DELETE FROM dbo\.listings WHERE id = @staged/);
});

test("rejecting touches only the staged listing", () => {
  const staged = code(read(api, "Listings", "StagedListings.cs"));
  const reject = staged.slice(staged.indexOf("RejectAsync"), staged.indexOf("DiscardAsync"));

  assert.match(reject, /UPDATE dbo\.listings/);
  assert.match(reject, /WHERE id = @staged AND staged_for_listing_id IS NOT NULL/);
  assert.doesNotMatch(reject, /@published/, "a refusal must not mention the published listing");
});

test("a file is deleted only when no row points at it", () => {
  /* A staged copy shares each photo's storage key with the published row -- copying the files to
     open an editor would be the wrong trade, and sharing is what makes "keep the live photo, drop
     it from my draft" mean anything. So deleting a staged row's photo must not delete the file the
     live page is serving. */
  const staged = code(read(api, "Listings", "StagedListings.cs"));
  assert.match(staged, /UnreferencedAsync/);
  assert.match(staged, /SELECT TOP \(1\) 1 FROM dbo\.listing_media WHERE storage_key = @key/);

  const media = code(read(api, "Endpoints", "OwnerMediaEndpoints.cs"));
  assert.match(media, /!await StillReferenced\(db, storageKey, ct\)/);

  // Files go after the commit, never inside the transaction that might roll back.
  const admin = code(read(api, "Endpoints", "AdminPendingChangeEndpoints.cs"));
  const approve = admin.slice(admin.indexOf("Task<IResult> Approve"));
  assert.ok(
    approve.indexOf("tx.CommitAsync") < approve.indexOf("storage.DeleteAsync"),
    "a rolled-back approval must not have deleted a photo already",
  );
});

test("the moderator sees all five sections and decides them together", () => {
  const admin = code(read(api, "Endpoints", "AdminPendingChangeEndpoints.cs"));

  for (const section of ["media", "hours", "about", "links"]) {
    assert.match(admin, new RegExp(`"${section}"`), `${section} must be compared`);
  }
  assert.match(admin, /"added"/);
  assert.match(admin, /"removed"/);
  assert.match(admin, /"moved"/, "a reordered photo is a change: the first one is what search shows");

  // Both decisions lock the staged row, so two moderators cannot both decide it.
  assert.match(admin, /UPDLOCK, HOLDLOCK, ROWLOCK/);
  assert.equal((admin.match(/LockStaged\(conn, tx, listingId, ct\)/g) ?? []).length, 2);

  const page = code(read(staffSrc, "app", "admin", "listing-changes", "page.tsx"));
  assert.match(page, /comparison\.data\.sections\.map/, "the screen renders every section");
});

test("the owner's screens tell them which version they are looking at", () => {
  const editor = read(mainSrc, "app", "account", "listings", "[id]", "edit", "page.tsx");

  // A published listing: no editor on the page, and a way to take the copy.
  assert.match(editor, /const published = listing\.status === "active"/);
  assert.match(editor, /startChangesAction/);
  assert.match(editor, /This listing is on the site/);

  // The copy: says so, links back to the live listing, and can be thrown away.
  assert.match(editor, /const isCopy = \(listing\.stagedForListingId \?\? null\) !== null/);
  assert.match(editor, /discardChangesAction/);

  // An unsaved new listing says it is unsaved rather than looking like a forgotten business.
  assert.match(editor, /listing\.isPlaceholder/);
});

test("adding a business posts, because pressing it creates the listing", () => {
  /* A link would be prefetched on hover, and prefetching a route that creates a row creates rows by
     pointing at them. Both entry points are forms. */
  const listings = read(mainSrc, "app", "account", "listings", "page.tsx");
  assert.match(listings, /<form action=\{startNewListingAction\}>/);
  assert.doesNotMatch(listings, /href="\/account\/listings\/new"/, "the CTA must not be a link");

  const newPage = read(mainSrc, "app", "account", "listings", "new", "page.tsx");
  assert.match(newPage, /action=\{startNewListingAction\}/);
  // The page that used to lock four sections behind "after saving" does not exist any more.
  assert.doesNotMatch(newPage, /After saving|AFTER SAVING/);
  assert.doesNotMatch(newPage, /ListingSection/, "the new-listing page is a button, not a half editor");
});

test("the superseded staging table is gone from the code as well as the schema", () => {
  assert.equal(
    existsSync(join(api, "Listings", "PendingChanges.cs")),
    false,
    "S0031's staging helper was replaced by StagedListings; two mechanisms is the one outcome to avoid",
  );
  assert.equal(
    existsSync(join(here, "check-pending-changes.test.mjs")),
    false,
    "its test was replaced by this file",
  );
});
