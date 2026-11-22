import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The cookie that holds a token expires when the token does.
 *
 * Four sessions, three cookie pairs, one API. The refresh cookies had drifted a long way from the
 * tokens inside them -- thirty days on the public site, seven on the staff site, against tokens the
 * API issued for fifteen minutes -- and nobody noticed, because nothing ever spent a refresh token.
 * What people did notice was the other half: the access cookie is derived from the token's own
 * lifetime, so a fifteen-minute token meant a fifteen-minute session, and switching tabs or
 * stepping away was enough to be signed out.
 *
 * The lifetimes are now one day everywhere. This keeps the two sides of each cookie honest: the
 * numbers are read from the API's own settings, so raising one without the other fails here rather
 * than in somebody's browser.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DAY = 60 * 60 * 24;

const authSettings = readFileSync(
  join(here, "..", "backend", "BusinessDirectory.Api", "Auth", "AuthSettings.cs"),
  "utf8",
);

/** A lifetime from AuthSettings.cs, read from the property default. `60 * 24` is evaluated. */
function settingOf(name) {
  const match = new RegExp(`public int ${name} \\{ get; init; \\} = ([^;]+);`).exec(authSettings);
  assert.ok(match, `${name} not found in AuthSettings.cs`);
  const expression = match[1].trim();
  assert.match(expression, /^[\d\s*]+$/, `${name} is not a plain number: ${expression}`);
  return expression.split("*").reduce((total, part) => total * Number(part.trim()), 1);
}

const cookieFile = (...parts) => readFileSync(join(here, "..", "apps", ...parts), "utf8");

/** The maxAge of a named cookie-options export, in seconds, with `60 * 60 * 24` evaluated. */
function maxAgeOf(source, exportName) {
  const match = new RegExp(`${exportName} = \\{ \\.\\.\\.base, maxAge: ([^}]+)\\}`).exec(source);
  assert.ok(match, `${exportName} not found, or no longer a plain maxAge`);
  const expression = match[1].replace(/,\s*$/, "").trim();
  assert.match(expression, /^[\d\s*]+$/, `${exportName} maxAge is not a plain number: ${expression}`);
  return expression.split("*").reduce((total, part) => total * Number(part.trim()), 1);
}

const staffCookies = cookieFile("staff-website", "src", "lib", "session-cookies.ts");
const ownerCookies = cookieFile("main-website", "src", "lib", "session-cookies.ts");
const customerCookies = cookieFile("main-website", "src", "lib", "customer-session-cookies.ts");

test("the scan reads the API's lifetimes", () => {
  // Guards the guard: a parser that silently returned nothing would make every assertion vacuous.
  assert.equal(settingOf("AccessTokenMinutes"), 60 * 24);
  assert.equal(settingOf("AdminAccessTokenMinutes"), 60 * 24);
  assert.equal(settingOf("RefreshTokenDays"), 1);
  assert.equal(settingOf("AdminRefreshTokenDays"), 1);
});

test("every session lasts a day", () => {
  for (const name of ["AccessTokenMinutes", "AdminAccessTokenMinutes"]) {
    assert.equal(settingOf(name) * 60, DAY, `${name} should be one day`);
  }
  for (const name of ["RefreshTokenDays", "AdminRefreshTokenDays"]) {
    assert.equal(settingOf(name) * DAY, DAY, `${name} should be one day`);
  }
});

test("each refresh cookie lives exactly as long as the token it holds", () => {
  // The staff site holds admin and super sessions; the public site holds owner and customer ones.
  assert.equal(
    maxAgeOf(staffCookies, "refreshCookieOptions"),
    settingOf("AdminRefreshTokenDays") * DAY,
    "the staff refresh cookie and the admin refresh token disagree",
  );
  assert.equal(
    maxAgeOf(ownerCookies, "refreshCookieOptions"),
    settingOf("RefreshTokenDays") * DAY,
    "the owner refresh cookie and the refresh token disagree",
  );
  assert.equal(
    maxAgeOf(customerCookies, "customerRefreshCookieOptions"),
    settingOf("RefreshTokenDays") * DAY,
    "the customer refresh cookie and the refresh token disagree",
  );
});

test("every access cookie is derived from the token, never hardcoded", () => {
  /* This is the half that decides when a tab stops working, and the only safe way to set it is
     from the `expiresInSeconds` the API returned with the token. A literal here would be a second
     source of truth, which is how the refresh cookies came to be wrong. */
  for (const [label, source, name] of [
    ["staff", staffCookies, "accessCookieOptions"],
    ["owner", ownerCookies, "accessCookieOptions"],
    ["customer", customerCookies, "customerAccessCookieOptions"],
  ]) {
    const match = new RegExp(`export function ${name}\\(expiresInSeconds: number\\)[\\s\\S]{0,220}?\\n\\}`)
      .exec(source);
    assert.ok(match, `${label}: ${name} is no longer a function of expiresInSeconds`);
    assert.match(match[0], /maxAge:\s*Math\.max\(expiresInSeconds\s*-\s*\d+/, `${label}: maxAge ignores the token's lifetime`);
  }
});

test("a rejected session clears only its own realm", () => {
  /* Somebody can hold two sessions at once -- a platform owner holds admin and super, and a phone
     number can be both a business owner and a customer. A reset route that cleared both would mean
     one rejected request signed them out of the session that was still good. */
  const staffReset = readFileSync(
    join(here, "..", "apps", "staff-website", "src", "app", "login", "reset", "route.ts"),
    "utf8",
  );
  const publicReset = readFileSync(
    join(here, "..", "apps", "main-website", "src", "app", "login", "reset", "route.ts"),
    "utf8",
  );

  // Each route decides on one realm and deletes that one's names.
  assert.match(staffReset, /searchParams\.get\("surface"\)/, "the staff reset route ignores which surface failed");
  assert.doesNotMatch(
    staffReset,
    /for \(const surface of \[/,
    "the staff reset route is looping over both surfaces again",
  );
  assert.match(publicReset, /searchParams\.get\("tab"\)/, "the public reset route ignores which realm failed");
});
