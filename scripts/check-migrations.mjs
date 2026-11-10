#!/usr/bin/env node
// Migration safety check. Run locally with `npm run check:migrations` and in CI.
//
// It checks database/sqlserver/migrations, the live path. database/migrations holds the original
// PostgreSQL migrations, kept as history (decision D41) and never run again, so there is nothing to
// enforce about them any more.
//
// Rules enforced:
//  1. Files are named S0001__short_description.sql, with an optional ".notx" before the extension
//     for a migration that has to run outside a transaction (see MigrationRunner).
//  2. Version numbers start at 1, have no gaps and no duplicates.
//  3. No file is empty.
//  4. Destructive statements (DROP TABLE/COLUMN/SCHEMA/DATABASE/TYPE, TRUNCATE, DELETE without WHERE,
//     ALTER COLUMN ... TYPE) are rejected unless the file contains an approval comment:
//         -- approved-destructive: <reason or ticket>
//     That comment is how a human approval is recorded in code review.
//  5. From S0026 onward, DROP CONSTRAINT with a hard-coded name is rejected. The production
//     database's schema was applied by hand and adopted with `npm run db:baseline`, so its primary
//     keys, foreign keys, unique keys and defaults carry server-generated names
//     (`PK__favourit__E123B678E7D5A97B`) rather than the ones these scripts declare. A migration
//     that names a constraint it did not create works on a clean database and fails there, which is
//     the worst way for a migration to be wrong: it passes every test and breaks in production.
//     Find the constraint in `sys` by what it is, then drop it through QUOTENAME -- S0013, S0017
//     and S0026 all show the pattern. The floor is S0026 because earlier migrations are already
//     applied and cannot be changed.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FILE_PATTERN = /^S(\d{4})__([a-z0-9_]+)(\.notx)?\.sql$/;
const APPROVAL_PATTERN = /^[ \t]*--[ \t]*approved-destructive:[ \t]*\S+/im; // reason must be on the same line

/** Remove comments and string literals so words inside them are not mistaken for SQL. */
export function stripSql(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2; // escaped quote
        else if (sql[i] === "'") { i++; break; }
        else i++;
      }
      out += "''";
    } else {
      out += sql[i++];
    }
  }
  return out;
}

/** Rule 5 applies from this version on. Earlier migrations are already applied and cannot change. */
export const DYNAMIC_DROP_FLOOR = 26;

/**
 * The constraint names a file drops literally, e.g. `DROP CONSTRAINT favourites_pkey`.
 *
 * A drop built through QUOTENAME is the approved form and does not match, because what follows
 * DROP CONSTRAINT there is a `'` (inside the string being built) rather than an identifier.
 * Pass the stripped SQL: comments and string literals must already be gone, or the pattern inside
 * the dynamic SQL would be read as real code.
 */
export function literalDropConstraints(code) {
  const names = [];
  const pattern = /\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([A-Za-z_@#][A-Za-z0-9_@#$]*|\[[^\]]+\])/gi;
  let m;
  while ((m = pattern.exec(code)) !== null) names.push(m[1]);
  return [...new Set(names)];
}

const DESTRUCTIVE_RULES = [
  { name: "DROP TABLE", test: (s) => /\bDROP\s+TABLE\b/i.test(s) },
  { name: "DROP COLUMN", test: (s) => /\bDROP\s+COLUMN\b/i.test(s) },
  { name: "DROP SCHEMA", test: (s) => /\bDROP\s+SCHEMA\b/i.test(s) },
  { name: "DROP DATABASE", test: (s) => /\bDROP\s+DATABASE\b/i.test(s) },
  { name: "DROP TYPE", test: (s) => /\bDROP\s+TYPE\b/i.test(s) },
  { name: "TRUNCATE", test: (s) => /\bTRUNCATE\b/i.test(s) },
  { name: "ALTER COLUMN ... TYPE", test: (s) => /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i.test(s) },
  {
    name: "DELETE without WHERE",
    test: (s) => s.split(";").some((stmt) => /\bDELETE\s+FROM\b/i.test(stmt) && !/\bWHERE\b/i.test(stmt)),
  },
];

/** Returns a list of human-readable problems. Empty list means the migrations pass. */
export function checkMigrations(dir) {
  const problems = [];
  if (!existsSync(dir)) return [`Migrations directory not found: ${dir}`];

  const sqlFiles = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".sql")).sort();
  const versions = [];

  for (const file of sqlFiles) {
    const match = FILE_PATTERN.exec(file);
    if (!match) {
      problems.push(`${file}: name must look like S0001__short_description.sql (lowercase letters, digits, underscores), optionally S0001__name.notx.sql.`);
      continue;
    }
    versions.push(Number(match[1]));

    const raw = readFileSync(path.join(dir, file), "utf8");
    const code = stripSql(raw);
    if (code.trim() === "") {
      problems.push(`${file}: file contains no SQL.`);
      continue;
    }

    const hits = DESTRUCTIVE_RULES.filter((r) => r.test(code)).map((r) => r.name);
    if (hits.length > 0 && !APPROVAL_PATTERN.test(raw)) {
      problems.push(
        `${file}: destructive statement(s) found (${hits.join(", ")}). ` +
          `Add a line "-- approved-destructive: <reason>" only after explicit approval.`,
      );
    }

    if (Number(match[1]) >= DYNAMIC_DROP_FLOOR) {
      const named = literalDropConstraints(code);
      if (named.length > 0) {
        problems.push(
          `${file}: DROP CONSTRAINT names a constraint directly (${named.join(", ")}). ` +
            `Production's constraint names are server-generated, so find it in sys by what it is ` +
            `and drop it through QUOTENAME (see S0026 for the pattern).`,
        );
      }
    }
  }

  const seen = new Set();
  for (const v of versions) {
    if (seen.has(v)) problems.push(`Duplicate migration version ${String(v).padStart(4, "0")}.`);
    seen.add(v);
  }
  const unique = [...seen].sort((a, b) => a - b);
  unique.forEach((v, idx) => {
    if (v !== idx + 1) {
      problems.push(`Version gap or bad start: expected S${String(idx + 1).padStart(4, "0")} but found S${String(v).padStart(4, "0")}.`);
    }
  });
  return [...new Set(problems)];
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(here, "..", "database", "sqlserver", "migrations");
  const problems = checkMigrations(dir);
  if (problems.length > 0) {
    console.error("Migration check FAILED:\n" + problems.map((p) => ` - ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(`Migration check passed (${dir}).`);
}
