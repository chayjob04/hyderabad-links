# Repair status — 2026-10-25

The production database repair, done. `docs/PROJECT_STATUS.md` records what was built before this.

## What the database turned out to be

`hyderab3_workingmodel` on `198.38.93.235` (SQL Server 2022 **Express**, collation
`SQL_Latin1_General_CP1_CI_AS`, full-text installed) holds **two unrelated applications**:

- **Another application, not this repository.** 58 PascalCase tables (`BusinessListings`,
  `ListingInfo`, `SuperAdmin`, …), 10 `usp_*` stored procedures and `__EFMigrationsHistory`. It holds
  the only pre-existing data: `BusinessListings` 3 rows, `Users_old` 2 rows. **Untouched throughout.**
- **This project.** 26 of its 33 tables, all empty except `plans` (4 reference rows) and
  `otp_challenges` (11 expired codes). There was no `dbo.SchemaVersions`, so DbUp had never run, and
  the tables were built by something else that only *approximated* the migrations.

No foreign key crosses between the two, verified from the live catalogue.

## How it was repaired, without dropping anything

Dropping and rebuilding this project's 27 tables was the first plan. It was abandoned in favour of a
purely additive repair, which turned out to be both safer and provably sufficient — the 13 scripts in
`database/sqlserver/checks/` assert *behaviour* and never reference a constraint name or `sys.*`
metadata, so the cosmetic divergences (system-generated constraint names, `datetimeoffset(7)` instead
of `(3)`, `nvarchar(100)` instead of `(120)`) affect nothing.

1. `npm run db:export` — backup and verification (SELECT only).
2. `npm run db:repair -- --apply` — created the one missing S0001 table, `category_search_terms`.
3. `npm run db:baseline -- --apply` — recorded S0001–S0007 in `dbo.SchemaVersions`.
4. `npm run db:migrate` — applied S0008, S0009, the new S0010, and all four reference seeds.
5. `npm run db:check` — **all 13 passed, 164 assertions**, against the live database.

Result: journal present, `search_trigrams` / `hl_similarity` / `hl_trigrams` present, 1 full-text
catalogue, 1 full-text index, 1 city, 103 localities, 151 categories, 125 category search terms,
12 permissions, 2 roles, 5 plans (Free and Verified active, the three old tiers deactivated).

## The five real bugs this found

**1. The login's default schema is not `dbo`.** It is `hyderab3_workingmodeluser`. Every
`CREATE TABLE` in the migrations was unqualified, so S0008's and S0009's tables would have been
built in the login's own schema while the existing 26 sat in `dbo` — a split-brain schema. It was
caught because the first repair script created `category_search_terms` in the wrong schema and
`db:baseline` went on correctly reporting it missing while the server's table count rose. Every
`CREATE` in S0008, S0009 and the repair script is now `dbo.`-qualified, as are all the seeds'
`INSERT`s, and `db:export`'s manifest now reports the login's default schema and lists any table
outside `dbo`.

**2. `permissions_code_format` was unsatisfiable.** The live CHECK contained
`NOT [code] LIKE '%._%'`. `_` is LIKE's single-character wildcard, not a literal underscore, so that
clause forbade any dot followed by a character — while another clause *required* a dot and a third
forbade a trailing one. No value could satisfy it, so `dbo.permissions` could never accept a row,
and the admin and super-admin permission system could never have worked on this database. Fixed by
**S0010**, which installs S0003's correct definition (where the underscore is inside a character
class, `'%[^a-z_.]%'`, and so is literal). Every other live CHECK was scanned for the same mistake;
this was the only one.

**3. `plans.slug` type mismatch.** S0005 declared `varchar(60)`; the live column is `nvarchar(50)`,
so S0009's foreign key was refused. S0005 and S0009 are now both `nvarchar(50)`, matching
production.

**4. The full-text index keyed on an index that did not exist.** S0008 said
`KEY INDEX listings_pkey` — the name S0002 gives that primary key. This database's `listings` was not
built by these migrations and its primary key is `PK__listings__3213E83F8FDFC6DA`. S0008 now looks
the primary key up in `sys.indexes` and builds the statement around whatever it finds, and throws
rather than skipping if there is none. S0008 is also now idempotent throughout — it is a `.notx`
script with no transaction, and the first failed run had already created the catalogue, so a re-run
would otherwise have failed on "catalogue already exists".

**5. Canonical URLs pointed at localhost on the deployed site.** `absoluteUrl()` fell back to
`http://localhost:3000` when `SITE_URL` was unset, and it was unset on the deployment —
`https://hyderabad-links-main.vercel.app/sitemap.xml` really does serve two `<loc>` entries, both
`http://localhost:3000/...`, as of this writing.

*Which site:* this is the Vercel project, **not** `hyderabadlinks.com`. That domain is attached to
none of the three Vercel projects and answers with `Microsoft-IIS/10.0` / `ASP.NET` / Plesk — it is
the other application, the one sharing this database. So the bug was not on the public domain, which
makes it less severe than it first looked, but it is still live on the deployment that will become
the public site. One function
feeds canonical tags on two page types, `LocalBusiness`/`ItemList` structured data, every
`/sitemap.xml` URL and the `Sitemap:` line in `robots.txt`. Vercel's own
`VERCEL_PROJECT_PRODUCTION_URL` now sits between `SITE_URL` and the localhost fallback, so a
deployment cannot emit a localhost URL even if `SITE_URL` is forgotten.

## Also fixed

- **The API base URL was resolved from the wrong variable first.** `api.ts`, `owner-api.ts` and
  `proxy.ts` each had their own copy of `NEXT_PUBLIC_API_URL ?? API_BASE_URL`. Both variables are
  set on the main Vercel project, `NEXT_PUBLIC_API_URL` about two days earlier than `API_BASE_URL`,
  so the older one won. The three copies are now one module, `src/lib/api-base.ts`, preferring
  `API_BASE_URL`; `NEXT_PUBLIC_API_URL` stays only as a deprecated fallback. The reason to prefer
  the server-only variable stands on its own: anything named `NEXT_PUBLIC_*` is inlined into the
  browser bundle by Next.js, and the API's address is not something the browser needs.

  **Correction, twice over.** This was first written up as the cause of the reported `ENOTFOUND`, on
  the reasoning that the older variable pointed at a host that no longer resolved. That was a
  hypothesis and it was wrong: the production site reaches the API at request time
  (`/api/localities/search?q=gachi` returns Gachibowli) and Vercel reports no runtime errors.

  **The actual cause is that no environment variable applies to a preview deployment at all.** Every
  variable on all three projects is scoped to the `production` target only, so a branch deployment
  gets none of them, `API_BASE_URL` is undefined, and the base URL falls back to the built-in
  `http://localhost:5080`. Reproduced on the preview built from this very branch:
  `/api/localities/search?q=gachi` answers **502 `lookup_failed`**, and its prerendered sitemap has
  two entries instead of 153 because the build could not reach the API either. A failed lookup of a
  localhost address is exactly the shape of the reported error, and it explains why production
  looked healthy throughout: the fault was only ever on previews.

  Fixing it means adding the `preview` target to `API_BASE_URL` on each project, which can be done
  without reading the encrypted value. It was **not** done here, for a reason worth a decision:
  there is no staging API or staging database, so a preview pointed at `API_BASE_URL` talks to the
  **production API and the production database** — an unreviewed PR preview could create real
  listings, enquiries or reviews. Enabling it makes previews reviewable; it also puts production
  data one preview away. That trade is the owner's to make.
- **`db:export` lost long exports.** ~425 round trips on one connection to shared hosting; the server
  dropped it part way and the `InvalidOperationException` was not a `SqlException`, so the per-query
  guards missed it. Queries now reopen and retry once, buffering results so a retry cannot duplicate
  or half-write a section.
- **`db:export` silently skipped all programmability.** `type_desc + ' ' + name` collided the server
  and database collations; the section came back as one "could not read" line. Fixed with
  `COLLATE DATABASE_DEFAULT`, which is how the other application's 10 procedures were found. The
  export now also writes `programmability.sql` with their full source, so the backup can restore
  them.
- **`db:baseline` printed a blank compatibility level** — `DATABASEPROPERTYEX` was asked for
  `'Compatibility'`, which is not a property name, and it returns NULL rather than erroring.

## Verified by running it

| Check | Result |
|---|---|
| `npm run verify` | **passed** — migration check, 19 script tests, typecheck, 3 production builds, .NET build, 388 unit, 127 integration |
| `npm run db:check` | **13/13 passed, 164 assertions**, against the live database |
| `/health/ready` | **Healthy** |
| `/categories` | **200**, 17 parents + 134 children, **125 search terms** across 70 categories |
| `/cities`, `/meta`, `/sitemap`, `/listings/nearby` | **200** |
| `/listings/search?q=plumber` | **200**, 0 results (there are no listings yet) — `CONTAINSTABLE` compiles and runs, which a broken full-text index would not |
| Trigram typo tolerance | **works** — `gachibowly`→Gachibowli, `madhapoor`→Madhapur, `kukatpaly`→Kukatpally, `begumpett`→Begumpet; none of these is a prefix, so the stored trigrams, their triggers and `hl_similarity` are all live |
| `/localities/nearest` | **works** — HITEC City's own coordinates resolve to HITEC City, 0 m |
| Owner OTP sign-in | **works** end to end — request 202, bad number 400, wrong code 400, correct code 200 with access + refresh tokens |
| Owner routes with a token | **200** on `/me`, `/me/overview`, `/me/listings`, `/me/enquiries`; overview shows the correct zeros and 0/6 checklist |
| Token audience separation | **enforced** — an owner token gets **401** on `/api/v1/admin` and `/api/v1/super-admin`; anonymous gets 401 |
| Main site (3000) | `/`, `/search`, `/search?q=`, `/search?category=`, `/robots.txt`, `/sitemap.xml`, `/login` all **200**; `/account` **307** to login. Home renders the real category tree. No error banner, clean server log |
| `/sitemap.xml` | **153 URLs** (2 fixed + 151 categories) once built with the API reachable |
| Admin site (3001) | `/login` **200**; `/listings`, `/reviews`, `/reports` **307** to login when anonymous |
| Super-admin site (3002) | `/login` **200**; `/overview`, `/admins`, `/audit` **307** to login when anonymous |

**Not proven:** full-text *ranking*. The index exists and `CONTAINSTABLE` runs, but there are no
listings to rank, and `v0002_smoke` skips its full-text assertion for the same reason (it needs the
dev seed, which must never run against production). It will be proven by the first real listing.

## Left behind, needs the owner

1. **A stray empty table: `hyderab3_workingmodeluser.category_search_terms`.** Created by the first
   version of the repair script before the default-schema problem was understood. It is harmless
   now — every write and the one read that touches that table name are `dbo.`-qualified — but while
   it exists it shadows `dbo.category_search_terms` for any *unqualified* query, which is how the
   125 search terms first went into it instead. Two ways to close this for good, both needing a
   privilege this session does not have:
   - `ALTER USER [hyderab3_workingmodeluser] WITH DEFAULT_SCHEMA = [dbo];` — the better fix. It
     makes unqualified creates and reads resolve to `dbo`, so the whole class of problem goes away.
   - `DROP TABLE [hyderab3_workingmodeluser].[category_search_terms];` — removes this instance only.
2. **One test row this session created:** a `users` row for `+91 98765 00123` (id 18), from proving
   the OTP sign-in works. Say the word and it goes.
3. **The first super-admin account.** Needs an email, a display name and a password. Run it
   yourself so the password never passes through this chat:
   ```powershell
   $env:ADMIN_BOOTSTRAP_PASSWORD = "<a strong password>"
   dotnet run --project backend/BusinessDirectory.Api -- create-admin --email "<you@domain>" --name "<Your Name>" --role super_admin
   ```
   Until that exists, the admin and super-admin sites can only be checked as far as their sign-in
   screens, which is where testing stopped.
4. **Vercel:** delete `NEXT_PUBLIC_API_URL` from the main project (now that `API_BASE_URL` wins),
   and add `SITE_URL`, plus `REVALIDATE_TOKEN` on main and `MAIN_SITE_URL` + `REVALIDATE_TOKEN` on
   admin. Without the token, `/api/revalidate` stays off and an approved listing waits out the
   60-second cache.
5. **MSG91** (`MSG91:AuthKey`, `MSG91:TemplateId`) — `Program.cs:106` registers `Msg91SmsSender`
   outside Development and throws without them. Never exercised: a test sends a real SMS and costs
   money.
6. **Email provider** (`Email:Provider`) — unset outside Development, so notifications are recorded
   as `failed` rather than sent. The table makes that visible, which is the design.
7. **Payment provider for the ₹399 Verified plan.** `subscription_payments.provider` defaults to
   `razorpay`; no keys, and no code writes the table yet.

## Second pass — links, entitlements and the deployed sites

**The Verified plan's links are now reachable.** `OwnerLinkEndpoints` adds
`GET|POST /api/v1/me/listings/{id}/links` and `DELETE .../links/{linkId}`. The allowance is read
from `listing_entitlements`, never from `listings.plan_slug`, so a lapsed subscription loses its
links on the next request. The slot is chosen as the lowest free position rather than from a count,
because a link removed from the middle leaves a gap and `listing_links_slot_idx` would refuse a
second link at an occupied one. Ownership is a join on `business_members` in every statement, so
another owner's listing is 404 and not 403.

**`listing_links_smoke.sql`** (16 assertions) proves the paid path *without a payment*: it creates a
current subscription, an expired one and an unpaid listing inside a transaction and rolls back, so
nothing is ever a real subscription. It asserts Free → `link_limit` 0 / unverified; current period →
Verified, 5 links, 10 photos, 3 videos; **expired period → Free again with no job having run**, which
is the point of deriving expiry from the clock; the lapsed listing still remembers what it bought;
five links fit and a sixth is refused by the database; two links cannot share a slot; a
`javascript:` URL, an unknown type and a blank label are each refused; a listing cannot hold two
active subscriptions; a backwards period and an unknown plan are refused; and links die with their
listing.

**Verified against the deployed sites.** `hyderabadlinks.com` is attached to none of the three
Vercel projects and answers `Microsoft-IIS/10.0` / ASP.NET / Plesk — it is the other application.
This project is on `hyderabad-links-main.vercel.app`, `hyderabad-links-nine.vercel.app` (admin) and
`hyderabad-links-super-admin.vercel.app`. The deployed main site reaches the API at request time
(`/api/localities/search?q=gachi` returns Gachibowli) and renders the real category tree; admin and
super-admin both redirect to their own `/login`. The deployed `/sitemap.xml` still serves two
`<loc>` entries pointing at `http://localhost:3000` — the `SITE_URL` fix is in the working tree and
not yet deployed.

**Vercel environment variables set** (they take effect on the next deployment): `SITE_URL` on main
and `MAIN_SITE_URL` on admin, both `https://hyderabad-links-main.vercel.app`. `REVALIDATE_TOKEN` was
deliberately **not** set — it is a shared secret and belongs to the owner, and setting it here would
have put the value in a transcript. `NEXT_PUBLIC_API_URL` was deliberately **not** deleted: the
deployed build still prefers it, so removing it before the new build ships would be a change with no
safety net.

**MSG91 failed late.** `Msg91SmsSender` reads its credentials when it sends, not when it is
constructed, so the API started cleanly without them and the first owner to sign in got a 500, with
nothing in the deployment log to warn anyone. `Program.cs` now writes a startup warning when either
setting is missing. A warning and not a throw on purpose: OTP is only owner sign-in, and search,
categories, locality lookup and every listing page work without SMS, so refusing to start would take
the public directory down over a feature most visitors never touch.

## Still to build (code, no access needed)

`subscriptions`, `subscription_payments` and `listing_links` now exist, and **nothing in the API
reads or writes any of them**. Expiry enforcement is already correct where it is *read* —
`OwnerMediaEndpoints.ReadAllowance` and `PublicHighlightsEndpoints` both go through the
`listing_entitlements` view rather than `listings.plan_slug`, so a lapsed listing loses its allowance
on the next request with no job to run. But:

- there is no way to **create** a subscription, so nothing can become Verified (needs the payment
  decision above);
- `listing_links` has no endpoints, so the "up to 5 website/social links" allowance is unreachable.
  This needs nothing from the owner and is the next piece of code.
