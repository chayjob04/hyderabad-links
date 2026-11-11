import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkMigrations, literalDropConstraints, stripSql } from "./check-migrations.mjs";

function withMigrations(files, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "mig-"));
  try {
    for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("empty directory passes", () => {
  withMigrations({}, (d) => assert.deepEqual(checkMigrations(d), []));
});

test("valid additive migrations pass", () => {
  withMigrations(
    {
      "S0001__create_cities.sql": "CREATE TABLE cities (id bigint PRIMARY KEY);",
      "S0002__add_slug.sql": "ALTER TABLE cities ADD COLUMN slug text;",
    },
    (d) => assert.deepEqual(checkMigrations(d), []),
  );
});

test("bad file name is rejected", () => {
  withMigrations({ "create_cities.sql": "CREATE TABLE a (id int);" }, (d) =>
    assert.match(checkMigrations(d).join("\n"), /name must look like/),
  );
});

test("gap in version numbers is rejected", () => {
  withMigrations({ "S0001__a.sql": "CREATE TABLE a (id int);", "S0003__c.sql": "CREATE TABLE c (id int);" }, (d) =>
    assert.match(checkMigrations(d).join("\n"), /expected S0002/),
  );
});

test("duplicate version is rejected", () => {
  withMigrations({ "S0001__a.sql": "CREATE TABLE a (id int);", "S0001__b.sql": "CREATE TABLE b (id int);" }, (d) =>
    assert.match(checkMigrations(d).join("\n"), /Duplicate migration version 0001/),
  );
});

test("empty or comment-only file is rejected", () => {
  withMigrations({ "S0001__a.sql": "-- nothing here\n" }, (d) => assert.match(checkMigrations(d).join("\n"), /no SQL/));
});

for (const [label, sql] of [
  ["DROP TABLE", "DROP TABLE cities;"],
  ["DROP COLUMN", "ALTER TABLE cities DROP COLUMN slug;"],
  ["TRUNCATE", "TRUNCATE cities;"],
  ["DELETE without WHERE", "DELETE FROM cities;"],
  ["ALTER COLUMN TYPE", "ALTER TABLE cities ALTER COLUMN name TYPE varchar(10);"],
  ["lowercase drop table", "drop table cities;"],
]) {
  test(`destructive statement rejected: ${label}`, () => {
    withMigrations({ "S0001__x.sql": sql }, (d) => assert.match(checkMigrations(d).join("\n"), /destructive/));
  });
}

test("destructive statement allowed with an approval comment that has a reason", () => {
  withMigrations({ "S0001__x.sql": "-- approved-destructive: ticket HL-42 removes unused table\nDROP TABLE old_cities;" }, (d) =>
    assert.deepEqual(checkMigrations(d), []),
  );
});

test("approval comment without a reason does not count", () => {
  withMigrations({ "S0001__x.sql": "-- approved-destructive:\nDROP TABLE old_cities;" }, (d) =>
    assert.match(checkMigrations(d).join("\n"), /destructive/),
  );
});

test("DELETE with WHERE is allowed", () => {
  withMigrations({ "S0001__x.sql": "DELETE FROM cities WHERE id = 1;" }, (d) => assert.deepEqual(checkMigrations(d), []));
});

test("words inside comments and string literals are ignored", () => {
  withMigrations(
    { "S0001__x.sql": "-- we will not DROP TABLE here\nINSERT INTO notes(body) VALUES ('please do not drop table or truncate');" },
    (d) => assert.deepEqual(checkMigrations(d), []),
  );
});

test("stripSql handles escaped quotes and block comments", () => {
  assert.equal(stripSql("SELECT 'it''s'; /* DROP TABLE x */ SELECT 1;").replace(/\s+/g, " "), "SELECT ''; SELECT 1;");
});

// ---------------------------------------------------------------- rule 5
// Production's constraint names are server-generated, so a migration that drops one by the name
// these scripts declare works on a clean database and fails there. Rule 5 catches that before it
// is written, from S0026 on.

/** A contiguous run of trivial migrations S0001..S<last-1>, so a test file can sit at the top. */
function runUpTo(last, topName, topSql) {
  const files = {};
  for (let v = 1; v < last; v++) {
    files[`S${String(v).padStart(4, "0")}__filler.sql`] = `ALTER TABLE t ADD c${v} int NULL;`;
  }
  files[topName] = topSql;
  return files;
}

test("literalDropConstraints finds a hard-coded name and ignores a QUOTENAME drop", () => {
  assert.deepEqual(
    literalDropConstraints("ALTER TABLE dbo.favourites DROP CONSTRAINT favourites_pkey;"),
    ["favourites_pkey"],
  );
  assert.deepEqual(
    literalDropConstraints("ALTER TABLE dbo.reviews DROP CONSTRAINT [reviews_one_per_person];"),
    ["[reviews_one_per_person]"],
  );
  // The approved form: the name is a variable, so there is no identifier after DROP CONSTRAINT.
  assert.deepEqual(
    literalDropConstraints(
      stripSql("SET @sql = N'ALTER TABLE dbo.favourites DROP CONSTRAINT ' + QUOTENAME(@name);"),
    ),
    [],
  );
});

test("a migration at or above the floor may not drop a constraint by name", () => {
  const problems = withMigrations(
    runUpTo(26, "S0026__identity.sql", "ALTER TABLE dbo.favourites DROP CONSTRAINT favourites_pkey;"),
    (d) => checkMigrations(d),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /DROP CONSTRAINT names a constraint directly \(favourites_pkey\)/);
});

test("the same migration passes when the name is discovered and quoted", () => {
  const sql = [
    "DECLARE @name sysname = (SELECT TOP (1) kc.name FROM sys.key_constraints kc",
    "  WHERE kc.parent_object_id = OBJECT_ID('dbo.favourites') AND kc.type = 'PK');",
    "DECLARE @sql nvarchar(400) = N'ALTER TABLE dbo.favourites DROP CONSTRAINT ' + QUOTENAME(@name) + N';';",
    "EXEC sp_executesql @sql;",
  ].join("\n");
  assert.deepEqual(withMigrations(runUpTo(26, "S0026__identity.sql", sql), (d) => checkMigrations(d)), []);
});

test("migrations below the floor are left alone: they are already applied", () => {
  assert.deepEqual(
    withMigrations(
      runUpTo(10, "S0010__fix_check.sql", "ALTER TABLE dbo.permissions DROP CONSTRAINT permissions_code_format;"),
      (d) => checkMigrations(d),
    ),
    [],
  );
});

test("the real S0026 discovers every constraint it drops", () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), "..", "database", "sqlserver", "migrations");
  const sql = readFileSync(path.join(dir, "S0026__customer_identity.sql"), "utf8");
  assert.deepEqual(literalDropConstraints(stripSql(sql)), []);
});

// ------------------------------------------------- reserved numbers in ../manual
// S0027 is the finalising half of the identity split and is run by hand, so it lives outside the
// migrations folder. It still owns its number: a later migration reusing it would be impossible to
// tell apart in the journal.

function withManual(migrations, manual, fn) {
  const root = mkdtempSync(path.join(tmpdir(), "mig-root-"));
  const dir = path.join(root, "migrations");
  const manualDir = path.join(root, "manual");
  try {
    for (const d of [dir, manualDir]) mkdirSync(d);
    for (const [name, sql] of Object.entries(migrations)) writeFileSync(path.join(dir, name), sql);
    for (const [name, sql] of Object.entries(manual)) writeFileSync(path.join(manualDir, name), sql);
    return fn(dir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a number held by ../manual fills the gap rather than failing", () => {
  const problems = withManual(
    {
      "S0001__first.sql": "ALTER TABLE t ADD a int NULL;",
      "S0003__third.sql": "ALTER TABLE t ADD c int NULL;",
    },
    { "S0002__done_by_hand.sql": "ALTER TABLE t ADD b int NULL;" },
    (d) => checkMigrations(d),
  );
  assert.deepEqual(problems, []);
});

test("a gap that ../manual does not account for is still rejected", () => {
  const problems = withManual(
    { "S0001__first.sql": "ALTER TABLE t ADD a int NULL;", "S0003__third.sql": "ALTER TABLE t ADD c int NULL;" },
    {},
    (d) => checkMigrations(d),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /expected S0002 but found S0003/);
});

test("the same number in both folders is rejected", () => {
  const problems = withManual(
    { "S0001__first.sql": "ALTER TABLE t ADD a int NULL;" },
    { "S0001__also_first.sql": "ALTER TABLE t ADD b int NULL;" },
    (d) => checkMigrations(d),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /also used in the migrations folder/);
});

test("a rollback script does not reserve its migration's number", () => {
  // S0026_down.sql belongs to S0026 and shares its number on purpose. One underscore, not two.
  const problems = withManual(
    { "S0001__first.sql": "ALTER TABLE t ADD a int NULL;" },
    { "S0001_down.sql": "ALTER TABLE t DROP COLUMN a;", "README.md": "notes" },
    (d) => checkMigrations(d),
  );
  assert.deepEqual(problems, []);
});

test("the real folders pass, with S0027 reserved by manual", () => {
  const here = path.dirname(new URL(import.meta.url).pathname.slice(1));
  const dir = path.join(here, "..", "database", "sqlserver", "migrations");
  assert.deepEqual(checkMigrations(dir), []);
});
