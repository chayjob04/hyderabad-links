import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Staff can grant a subscription, and nothing about that can look like a payment.
 *
 * This is the feature where a quiet mistake costs real money or real trust: a granted period
 * recorded as a payment would show up as revenue in a report somebody reconciles against Razorpay,
 * and a paid period that staff could end would be a refund nobody processed. Both of those are one
 * line of SQL away at any time, and neither fails a build — so they are asserted here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, "..", "backend", "BusinessDirectory.Api");
const staffSrc = join(here, "..", "apps", "staff-website", "src");
const read = (...parts) => readFileSync(join(...parts), "utf8");

/** Source with comments stripped, so prose about a rule is not read as the rule. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* The same for SQL, whose comments start with two dashes. The migration's header explains at length
   what it does *not* touch, and naming `subscription_payments` there satisfied a search for it --
   the third time in this project a scan has read a comment as code. */
const sqlCode = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const writes = () => code(read(api, "Endpoints", "SuperAdminSubscriptionWriteEndpoints.cs"));

test("the migration makes a granted period say who granted it and why", () => {
  const sql = read(here, "..", "database", "sqlserver", "migrations", "S0033__complimentary_subscriptions.sql");

  assert.match(sql, /source IN \('payment', 'complimentary'\)/);
  assert.match(sql, /DEFAULT 'payment'/, "every existing row is what it is: a payment");
  assert.match(sql, /subscriptions_grant_check/);

  /* Both halves of that CHECK matter. A complimentary period must name an admin and a reason; a
     paid one must name neither, which is what stops a grant being filed as a payment. */
  assert.match(sql, /source = 'complimentary'[\s\S]{0,200}granted_by_admin_id IS NOT NULL/);
  assert.match(sql, /source = 'payment' AND granted_by_admin_id IS NULL AND grant_reason IS NULL/);

  // It adds columns. It must not touch money.
  assert.doesNotMatch(sqlCode(sql), /subscription_payments/i, "this migration must not touch payments");
  assert.doesNotMatch(sqlCode(sql), /DELETE\s+FROM/i);
});

test("no write endpoint touches a payment record", () => {
  /* The line that would make this feature dangerous. `subscription_payments` is the record of money
     taken, and these endpoints are the record of money NOT taken. */
  assert.doesNotMatch(
    writes(),
    /subscription_payments/i,
    "granting a period must never write, change or delete a payment",
  );
});

test("a granted period is marked complimentary, never paid", () => {
  const source = writes();

  assert.match(source, /'complimentary', @admin, @reason/, "the insert records the source, admin and reason");
  assert.doesNotMatch(
    source,
    /source\s*=\s*'payment'|'payment',\s*@admin/,
    "nothing here may write a period as paid for",
  );
  assert.match(source, /paymentTaken = false/, "and the audit entry says no money changed hands");
});

test("a paid period cannot be ended here", () => {
  const source = writes();
  const revoke = source.slice(source.indexOf("Task<IResult> Revoke"));

  assert.match(revoke, /Source != ComplimentarySource/, "only a granted period may be ended");
  assert.match(revoke, /[Rr]efund/, "and the refusal says why, rather than the button doing nothing");
  assert.doesNotMatch(revoke, /DELETE\s+FROM/i, "ending a period cancels it; nothing is deleted");
});

test("every action needs a reason and lands in the audit log with both states", () => {
  const source = writes();

  // Four actions, four audit entries, each with a before and an after.
  for (const action of [
    "subscription.granted",
    "subscription.extended",
    "subscription.plan_changed",
    "subscription.revoked",
  ]) {
    assert.match(source, new RegExp(action.replace(".", "\\.")), `${action} must be audited`);
  }
  assert.equal((source.match(/before = new/g) ?? []).length, 4, "each decision records the state before");
  assert.equal((source.match(/reason,/g) ?? []).length >= 4, true, "and the reason given");

  // The reason is checked, not merely accepted.
  assert.match(source, /BadReason\(request\.Reason, out var reason\)/);
  assert.equal((source.match(/BadReason\(/g) ?? []).length, 5, "one helper, used by all four actions");
});

test("the writes are behind the super gate and plans.manage", () => {
  const source = writes();

  assert.match(source, /AdminAccess\.AuthorizeSuper\(admin, AdminPermissions\.PlansManage\)/);
  assert.doesNotMatch(source, /AdminAccess\.Authorize\(admin/, "the ordinary admin gate is not enough here");
  // And every handler goes through it.
  assert.equal((source.match(/await Gate\(principal, db, ct\)/g) ?? []).length, 4);
});

test("two admins cannot act on one listing at the same moment", () => {
  const source = writes();

  assert.match(source, /UPDLOCK, HOLDLOCK, ROWLOCK/, "the listing row is locked for the transaction");
  assert.equal((source.match(/LockListing\(conn, tx, listingId, ct\)/g) ?? []).length, 4);
});

test("a period can only be granted when there is not one already", () => {
  const source = writes();
  const grant = source.slice(source.indexOf("Task<IResult> Grant"), source.indexOf("Task<IResult> Extend"));

  assert.match(grant, /SubscriptionId is not null/, "a second overlapping period is refused");
  assert.match(grant, /Status409Conflict/);
});

test("the screen tells the truth about what it does not do", () => {
  const page = read(staffSrc, "app", "super-admin", "subscriptions", "page.tsx");

  assert.match(page, /No payment is\s*\n?\s*recorded/, "the dialog says no payment is recorded");
  assert.match(page, /refund/i, "and that a paid period is a refund, not a button");
  // The granted periods are counted apart from the paid ones.
  assert.match(page, /summary\.complimentary/);
  // Ending one is only offered for a granted period.
  assert.match(page, /row\.source === "complimentary" \? \([\s\S]{0,400}revokeAction/);
});
