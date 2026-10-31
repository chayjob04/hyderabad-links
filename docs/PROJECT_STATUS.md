# Project status and handoff

**Updated:** 2026-10-27. Read this first, then `CLAUDE.md`. It replaces re-auditing the repository.

## How to read this file

It is cumulative, and the project has moved faster than its prose. Three rules settle any
disagreement inside it:

1. **This section, "Where the project is today" and "What changed since 2026-10-25" are the current
   record.** Where anything further down contradicts them, they are wrong and these are right.
2. **`docs/REPAIR_STATUS.md` (2026-10-25)** is the record of the production database repair and the
   four passes that followed it, and is still accurate on the database, the paid path, and what the
   owner has to supply.
3. **A section headed with a date is history.** "Verified on 2026-10-20" and "SQL Server conversion"
   are both that. Their results stand as the record of what was run on the day, but they describe
   public URLs and an owner flow that the 26 October changes replaced, so do not read them as a
   description of today's site.

## Where the project is today

- **The platform runs on one shared SQL Server database** (`hyderab3_workingmodel`), which holds an
  unrelated application as well. Migrations `S0001`–`S0017` are applied to it and the 17
  transactional checks in `database/sqlserver/checks/` pass against it. See `REPAIR_STATUS.md` for
  how that database was adopted and what it cost.
- **Two plans, not four.** Free, and **Verified at ₹399 a year**: 10 photos, 2 videos, 1 logo, 5
  links and the badge (`S0016`; the three old tiers were deleted by `S0011`). Entitlement is
  computed from the subscription period against the clock through the `listing_entitlements` view,
  never read from `listings.plan_slug`, and the allowance is applied at read time by
  `dbo.listing_visible_media`, so a lapsed plan hides media instead of deleting it.
- **Public URLs are category-first** — `/food`, `/food/cafes`, `/food/cafes/garden-cafe`, with areas
  at `/areas/madhapur` and `/areas/madhapur/cafes`. This replaced the locality-first
  `/{city}/{locality}/{category}/{slug}` scheme on 26 October and **supersedes D22**, which
  `docs/decisions.md` does not yet say. The **API** still addresses a listing as
  `{city}/{locality}/{slug}`; only the websites' URLs changed.
- **An admin reviews; a super admin writes.** Approve, reject, suspend, reinstate, the review and
  report queues, correction requests and the taxonomy are the admin surface. Creating, editing,
  archiving and deleting a listing, and curating Featured, are super-admin only. The write routes
  are *absent* from `/api/v1/admin` rather than merely refused, and a test asserts they answer 404
  or 405.
- **Saving an owner listing sends it to review**, and so does every later edit — including an edit
  to a live listing, which leaves the public site until a moderator approves the change. Onboarding
  is the one exception and stays a draft, because it collects no address or description.
- **Nothing that costs money is configured.** No payment has ever been taken, no media file has ever
  been stored in a real bucket, and no email or SMS has been delivered outside Development. Each of
  those integrations refuses to pretend: the paying routes answer 503, uploads answer 503, and a
  notification is recorded as `failed` rather than reported as sent.
- **`Auth:DummyOtpEnabled` is an authentication bypass** that makes every owner login code `123456`.
  It is off by default, announced on every start and logged on every code issued. It exists because
  MSG91 delivery is still unproven and the owner journey is untestable without it. **Turn it off
  before anyone else can reach the site.**
- **The deployed sites are the three Vercel projects**, not `hyderabadlinks.com` — that domain still
  answers from the other application. See `REPAIR_STATUS.md`.

## What changed since 2026-10-25

`REPAIR_STATUS.md` ends with its fourth pass. These are the 22 commits after it, which no other
document records; each commit message carries the full reasoning.

**26 October — the shape of the public site.**

- **Category-first URLs** (`e44396a`). Category browsing used to be `/search?category=cafes`, which
  a search engine reads as one page with a parameter rather than as a page each. The two shapes
  cannot coexist — `/food/cafes/garden-cafe` and `/hyderabad/madhapur/dentists` are both three
  segments, so the router would read "food" as a city — so the city/locality shape went rather than
  sitting alongside. Areas moved under `/areas`, and that word is now reserved: a category slugged
  `areas` would make every area page unreachable, so the taxonomy endpoints refuse it.
- **A redirect loop that made every listing page unreachable** (`076957c`), caused by that move and
  fixed the same day: the canonical check compared the *parent* category with the listing's
  subcategory, so every listing redirected to itself. It now compares whole paths, which cannot
  loop.
- **The admin / super-admin split** (`2b9acaa`). Admins review and manage the taxonomy; super admins
  write listings. A slug is never editable after creation, because public URLs are built from it and
  these tables have no slug history, and retiring a category sets `is_active = 0` rather than
  deleting it, so the listings on it keep working.
- **Saving sends a listing to review** (`5d00039`), and so does every edit. A listing used to sit as
  a draft until the owner found a button nobody had told them about, and a live listing could be
  rewritten without any moderator seeing the change.
- **Search became about finding a business rather than narrowing a list** (`2f7de67`, `738e0ef`,
  `b6d4221`). Choosing an area no longer filters: it supplies a point and orders by distance from
  it, because on a directory this size a hard area filter almost always returns nothing (Habsiguda
  went from 0 results to both businesses, nearest first). Typed text becomes a category filter only
  when it *is* a category, so "Dental Delights" is no longer hidden by the Dentists filter. "All" is
  now an explicit choice in both pickers instead of a blank first option.
- **Chrome and content** (`85d8d85`, `5fd05ec`, `e99892c`, `4f26b02`, `077e26f`, `7a8cb16`): an
  account menu in place of the LogIn button for someone already signed in, a reworked footer, a
  category bar that no longer overlaps the logo, and `/help`, `/terms` and `/privacy`, which exist
  now.
- **MSG91 finished** (`903d4df`): a failed send no longer burns the owner's five-codes-an-hour
  allowance, an outage answers 503 instead of 500, and MSG91's own words travel with the failure —
  an unapproved template, a wrong auth key and an empty balance were previously indistinguishable.
- **The dummy OTP switch** (`c67ca32`) — see "Where the project is today".

**27 October — the plan, the media store, and what staff can do.**

- **The Verified plan allows two videos** (`3ae7f7b`, `S0016`), the one number that differed from
  the plan the owner confirmed. Existing media is untouched and does not need to be:
  `listing_visible_media` applies the allowance at read time, so a listing with three videos shows
  two and keeps the third.
- **Link previews** (`3ae7f7b`). The site had no Open Graph or Twitter metadata at all, so a listing
  shared into WhatsApp — which this directory tells people to use to reach a business — arrived as a
  bare URL. The homepage also carries `Organization` and `WebSite` structured data, and `/search`
  left the sitemap, because that page sets `noindex` and listing it was a contradiction.
- **`Server: Kestrel` is off** (`a7a579b`). The rest of that response audit was clean.
- **Media can be stored in Cloudflare R2** (`4914ff1`, D49), through the AWS S3 client behind the
  `IMediaStorage` seam that was already there; Azure Blob Storage still works and `Media:Provider`
  chooses. Unlike the Azure path, the API does not create the bucket: an R2 bucket serves nothing
  until a domain is bound to it in the dashboard, so one created automatically would accept uploads
  and serve nothing.
- **A `rzp_live_` key is refused** unless `Payments:LiveModeApproved` is true (`4914ff1`, D50), on
  the owner's instruction to keep test mode until live payments are approved.
- **Featured is curated by a super admin** (`3225bc3`, D51). It used to mean "has a paid Verified
  period running", which made the shelf a list of whoever had bought the plan rather than a
  recommendation anybody had made. It starts **empty**. Trending is untouched and stays computed
  from enquiries, favourites and approved reviews over 30 days, at read time, with no screen
  anywhere, because the earned shelf only works if nobody can touch it.
- **Staff can send an owner a correction request** (`3225bc3`, D52, `listing_alerts`). The only
  thing an admin could do about a wrong phone number was suspend the business, which punishes the
  customer looking for them more than the owner who mistyped a digit. It has its own table rather
  than reusing `notifications`, which records delivery *attempts*, so a bounced address cannot lose
  the message.
- **The permission catalogue is asserted by name** (`4c5d2aa`), not by count, and the admin-role
  check now looks both ways: written as one `EXCEPT … UNION ALL … EXCEPT` chain it could only see a
  *missing* grant and never an extra one, which is the half that exists to catch an admin holding
  `listings.create`.

**Verified on 2026-10-27:** `npm run verify` **passes** — migration check, 19 script tests,
typecheck, three production builds, .NET build with 0 warnings, **534 unit and 185 integration
tests**. `npm run db:check` was last run by the commit that needed it (`4c5d2aa`): **17 checks
against the live database**. It was not re-run while this file was written, because it runs against
whatever `ConnectionStrings:Default` points at, which is the shared production database.

## SQL Server conversion — DONE for the application (2026-10-20 to 2026-10-21)

The platform runs on **Microsoft SQL Server**, and Azure SQL Database in production (decision D41,
approved by the owner). PostgreSQL support was **not** kept: nothing in the application connects to
it, and `database/migrations`, `database/seeds` and `database/checks` are kept only as history.

**What that means in practice.** `npm run db:migrate` builds the schema with DbUp from `database/sqlserver/migrations`, `npm run db:seed-dev` loads the
sample listings, and the API, the three websites and every feature built before the conversion work
exactly as they did. The whole site was driven end to end against SQL Server; see the table below.

### What was converted

| Piece | How |
|---|---|
| Driver | `Npgsql` → `Microsoft.Data.SqlClient`, `dbup-postgresql` → `dbup-sqlserver`. `NpgsqlDataSource` has no equivalent, so `Data/SqlDatabase.cs` keeps the two calls the forty handlers made (`CreateCommand`, `OpenConnectionAsync`) under the same names |
| Schema | `database/sqlserver/migrations/S0001`–`S0008`, grouped by subject the same way the PostgreSQL files were, so each can be read beside its counterpart. `S0008` is the search machinery, which has no counterpart |
| Spatial | PostGIS `geography(Point,4326)` → SQL Server `geography`; `ST_Distance`/`ST_DWithin`/`<->` → `STDistance`; `ST_MakePoint(lng, lat)` → `geography::Point(lat, lng, 4326)` (**the argument order differs**) |
| Full-text search | The generated `tsvector` column is gone; a full-text index covers `name` and `description`, and `PublicSearchEndpoints` combines two `CONTAINSTABLE` ranks to keep the old "name outranks description" weighting. What someone typed is turned into a safe `CONTAINS` condition by `FullTextQuery`, because SQL Server has no `websearch_to_tsquery` and a stray quote would otherwise be a syntax error |
| Typo tolerance | pg_trgm → a stored trigram table with pg_trgm's own similarity formula (decision D42). Maintained by triggers on `localities`, `categories` and `listings` |
| Arrays | `categories.search_terms` (`text[]`) → the `category_search_terms` table; `array_agg` → `STRING_AGG` with the list split in C#; `ANY(@array)` and `unnest` → `STRING_SPLIT` over a comma-separated parameter |
| Query syntax | `RETURNING` → `OUTPUT`; `ON CONFLICT` → `UPDATE` then `INSERT … WHERE NOT EXISTS`; `FOR UPDATE` → `WITH (UPDLOCK, HOLDLOCK, ROWLOCK)`; `FOR UPDATE SKIP LOCKED` → `WITH (UPDLOCK, READPAST)`; `LIMIT/OFFSET` → `TOP` or `OFFSET … FETCH`; `make_interval`/`interval` → `DATEADD`; `count(*)` → `COUNT_BIG(*)` (SQL Server's `COUNT` returns `int`, and every reader expected `bigint`); `DELETE … USING` → `DELETE x FROM … JOIN`; `NULLS LAST` → an explicit "is it null" sort column |
| Booleans | SQL Server has no boolean: a flag in a `WHERE` is compared (`is_active = 1`), and a condition read as a column is wrapped (`CAST(CASE WHEN … THEN 1 ELSE 0 END AS bit)`) |
| Regex constraints | Each `CHECK (x ~ '…')` became `LIKE` patterns over **`Latin1_General_BIN2`**. A binary collation is required: a range like `[a-z]` is read through the collation, and even a case-*sensitive* one orders `aAbBcC…`, so `ABIDS` passed as a slug until this was fixed |
| Migration running | Two DbUp passes. `CREATE FULLTEXT CATALOG` cannot run inside a transaction, so files named `*.notx.sql` are applied without one and everything else keeps its transaction per script |

### Verified against SQL Server 2022 (Developer Edition, with full-text search installed)

*These results were produced on 2026-10-21 against a local SQL Server container, which the project
no longer uses. They stand as the record of the conversion; re-running them now means pointing
`ConnectionStrings:Default` at an Azure SQL database.*

| Check | Result |
|---|---|
| `npm run verify` | **passed** — migration check, 19 script tests, typecheck, three production builds, .NET build, 388 unit tests, 127 integration tests |
| `npm run db:migrate` into an empty database | **passed**, repeatedly: the database was dropped and rebuilt from nothing several times, ending with DbUp's own journal, the 8 migrations and the 4 reference seeds |
| Reference seeds, re-applied | **idempotent** — 103 localities, 151 categories, 125 search terms, 12 permissions, 2 roles, 19 role permissions, 4 plans, and a second and third run changed none of it |
| `npm run db:seed-dev` | **passed** — 29 sample businesses, listings and primary categories, and 1,067 listing trigram rows generated by the trigger |
| `database/sqlserver/checks/constraints_smoke.sql` | **passed**, 20 assertions: every bad phone number, slug, admin email, newline-bearing recipient, impossible notification state and half-filled dimension pair refused; a misspelling scoring 0.815 and an unrelated word 0; a rename moving the trigrams; and the audit log refusing both UPDATE and DELETE |
| `npm run db:check` — all thirteen checks | **passed**, 163 assertions in total (2026-10-21). Per file: `admin_mfa_smoke` 9, `admin_moderation_smoke` 22, `constraints_smoke` 20, `enquiry_smoke` 10, `locality_search_smoke` 12, `media_smoke` 15, `notification_smoke` 18, `onboarding_smoke` 9, `owner_overview_smoke` 7, `review_smoke` 12, `search_smoke` 10, `v0002_smoke` 8, `v0003_smoke` 11. The runner itself was checked against a deliberately failing script, so a pass is a pass and not a silent no-op |
| The public and owner API, end to end (32 checks) | **works** — categories, localities, cities, sitemap, nearby, search, listing detail, reviews; OTP sign-in creating an account; onboarding creating business + membership + draft listing in one transaction, and repeating it not overwriting the profile; listing read, edit and submit; the media allowance and the Free plan refusing a photo; a customer enquiry; a review held for moderation; favourites saved, listed and removed; an abuse report; a profile update; refresh-token rotation, and the old token refused afterwards |
| The admin and super-admin API, end to end (21 checks) | **works** — password + authenticator sign-in with ten recovery codes; the moderation queue; approve; suspend and reinstate; the review queue and approving one; the report queue and closing one; an admin adding a listing; the super-admin token issued only to a super admin and an ordinary admin token refused by `/api/v1/super-admin`; overview figures matching the database row for row; setting roles; and the change appearing in the audit log |
| Search behaviour, compared with what PostgreSQL did | **matches** — `plumbers` finds the four sample plumbers through full-text search, the misspelling `plumers` finds the same four through the trigram fallback, `patan` finds Patancheru, `gachi` finds Gachibowli, and a distance sort returns 1,214 m / 1,282 m / 1,865 m from HITEC City in order |

### Bugs this conversion found, each by running it rather than reading it

1. **An upper-case slug was accepted.** `[a-z]` in a `LIKE` pattern is interpreted through the
   collation, and `Latin1_General_CS_AS` orders `aAbBcC…`, so upper-case letters fall inside the
   range. Fixed by comparing under `Latin1_General_BIN2`. Found by `constraints_smoke`.
2. **`CREATE FULLTEXT CATALOG` cannot run inside a transaction**, which DbUp's transaction-per-script
   mode put it in. Fixed with the two-pass runner above.
3. **A bare `OUTPUT` is refused on a table that has a trigger**, and `listings` has one for the
   trigrams. Fixed with `OUTPUT … INTO` a table variable.
4. **`COUNT(*)` returns `int`**, not `bigint`, so every reader that called `GetInt64` threw.
5. **`SUM(…)` over no rows is NULL** where `count(*)` was 0, which would have made the first enquiry
   from an address fail.
6. **An upsert written as UPDATE-then-INSERT returns two result sets**, one of them empty, so the
   reader has to walk to whichever produced the row.
7. **`roles.id` is an `int`** and Npgsql had been widening it to `long` on request; SqlClient does not.
8. **A full-text assertion inside a rolled-back transaction passes for the wrong reason.** The
   full-text index is maintained asynchronously and cannot see uncommitted rows, so the first
   converted `v0002_smoke` matched a leftover *committed* row instead of the one it had just
   inserted — the query was wrong and the test still said ok. Found by searching for a word that
   could only exist in the uncommitted row and getting 0 rows back. Full-text is now asserted
   against committed rows, outside the transaction.
9. **A check that relied on the dev database being pristine.** `slug LIKE 'smoke-%'` also matched a
   row left behind by an earlier end-to-end API run, so four assertions in `search_smoke` counted
   one row too many. Each check now uses a slug prefix of its own.
10. **`datetimeoffset` defaults to scale 7 but the columns are `datetimeoffset(3)`**, so a
    full-precision value held in a variable does not round-trip through the column. It made
    `admin_moderation_smoke`'s "re-approving keeps the original publication date" fail against
    correct schema behaviour. The check now reads the stored value back, which is what the
    PostgreSQL original did.

### Not converted, and still PostgreSQL

Nothing. The twelve transactional checks that were still PL/pgSQL were converted on 2026-10-21 and
all thirteen now run against SQL Server through `npm run db:check`, reported in the table above. What remains in `database/migrations`, `database/seeds` and `database/checks` is history
only; each folder has a README saying so, and nothing in the project reads them.

### Azure SQL Database (checked against the documented limits, not against a live Azure database)

- **Full-text search** is supported, including the `CONTAINSTABLE` form used here. Semantic search
  (`SEMANTICKEYPHRASETABLE`) is not supported on Azure SQL and is not used.
- **Spatial** types, methods and spatial indexes are supported.
- **Collation** is fixed when the database is created and cannot be changed afterwards. Everything
  assumes a case-insensitive database collation — `SQL_Latin1_General_CP1_CI_AS`, what the local
  container uses — with explicit `COLLATE` clauses where a check needs case or binary comparison.
  **The production database must be created with that collation.**
- **The migration runner must not create the database.** Azure SQL's `CREATE DATABASE` takes its own
  options (service objective, elastic pool) and belongs with whoever provisions it. DbUp here only
  connects to a database that already exists.
- **SQL Agent does not exist** on Azure SQL Database. Nothing scheduled is used today; a retry worker
  for notifications could not be an Agent job (Elastic Jobs, or the API itself).
- **Cross-database queries and `USE`** are unsupported; nothing here needs either.
- Connection strings must keep `Encrypt=True`. The local one also carries
  `TrustServerCertificate=True`, which is for the container's self-signed certificate and **must not**
  be used against Azure.

### Configuring a database

**Locally** — there is no local database engine. Development runs against an Azure SQL database, so
the engine, the collation and the feature set are the ones production uses. Set the connection
string with user-secrets, never in `appsettings.Development.json`, which is tracked:

```powershell
dotnet user-secrets set "ConnectionStrings:Default" "<your Azure SQL connection string>" --project backend/BusinessDirectory.Api
npm run db:migrate
npm run db:seed-dev
```

The database itself must already exist: Azure SQL creates one with its own collation, service tier
and backup policy, so the migration runner deliberately never creates one. `CREATE DATABASE` from
the portal, the Azure CLI, or any SQL client connected to the server.

Full-text search must be available on the target. It is on by default on Azure SQL Database, and
the `S0008` migration fails outright on a server without it rather than quietly skipping the index.

**Azure SQL later** — provision the database with a case-insensitive collation, then set
`ConnectionStrings__Default` on the API's App Service to a Key Vault reference holding
`Server=tcp:<server>.database.windows.net,1433;Database=<db>;Authentication=Active Directory Default;Encrypt=True`
(or a SQL login while managed identity is not set up). Run `-- migrate` as a gated deployment step,
never from the running API. Nothing in this repository has been pointed at an Azure SQL database:
that step is untested and is the next thing to verify.

## Architecture as built

Three Next.js apps (`apps/main-website`, `apps/admin-website`,
`apps/super-admin-website`), one ASP.NET Core API
(`backend/BusinessDirectory.Api`), and one Microsoft SQL Server /
Azure SQL Database. Browser → its own Next.js server → API → SQL Server.
No ORM; raw parameterized SQL via `Microsoft.Data.SqlClient`.

> **Open architecture question.** The master brief asks for *two* APIs — `BusinessListings.Api`
> (businesses, listings, branches, categories, localities, search) and `Platform.Api` (auth, users,
> subscriptions, payments, enquiries, reviews, admin, audit). The repository has one API, and
> decision D1 in `docs/decisions.md` records the single modular API as **approved**. Splitting it is
> a real migration with real cost. **It needs the owner's decision before anyone starts it** — see
> "Decisions needed" below. Nothing currently blocks feature work either way: the API is already
> organised by audience, so the split would mostly move folders.

## Verified on 2026-10-20 (history)

All of this was run locally and observed rather than assumed — **on that day**. Several of the
browser walks below describe `/{city}/{locality}/{category}/{slug}` URLs and the draft → "Submit for
review" flow, both of which the 26 October changes replaced, and the media walks describe the four
old plans. They are kept as the record of what was actually run, not as a description of today's
site.

| Check | Result |
|---|---|
| `npm run verify` (migration check, script tests, typecheck, 3 production builds, .NET build + tests) | **passed** |
| .NET unit tests | **388 passed**, 0 failed |
| .NET integration tests | **127 passed**, 0 failed |
| `database/checks/notification_smoke.sql` | **passed** (rolls back) — a new notification is pending, never attempted; the owner-lookup join finds the listing's owner with an address; marking it sent stamps `sent_at`; a sent row cannot also carry an error; a failure must give a reason and must not look like it went out; a pending row cannot claim attempts; the kind, channel, subject-type and status enumerations each refuse an unknown value; a blank, mixed-case, `@`-less or **newline-carrying** recipient is refused on the email channel while a phone number is accepted on the sms channel; and the delivery record outlives the owner's deleted account |
| Notifications against the running API, in Development | **works** — 3 real requests through the console sender. A customer enquiry to a live listing printed the whole message to the API console (`To: owner.notify.test@example.com`, "New enquiry for Ravi Kumar Plumbing", the customer's name, normalised number `+919876500777`, lowercased email, the message, and the time as `3:23 PM IST`) and the row was `sent`, `attempts = 1`. Approving a pending listing printed "Redesign Test Bakery is now live on HYDERABAD LINKS" with the real public URL; rejecting one printed the moderator's reason as written with the `/account/listings` link. All three rows carried the right kind, recipient and subject |
| Notification **failure** is visible, against a Staging instance | **works** — the same enquiry sent to an API started as `Staging` (so `UnconfiguredEmailSender`) still answered **201** and still stored the enquiry; the notification row was `failed`, `attempts = 1`, with `InvalidOperationException: No email provider is configured (Email:Provider).` and no `sent_at`. This is the whole point of the table: nothing is silently lost |
| Super-admin surface, against the running API | **works** — 36 checks with two real accounts: an ordinary administrator is issued **no** super-admin token, and a super admin is issued one alongside the admin token; `/api/v1/super-admin` refuses an anonymous caller, an ordinary admin token, **and the super admin's own admin-audience token**, accepting only the super-admin one; a super-admin token is refused by `/api/v1/admin`. The overview's figures match the database row for row. Roles can be cleared and restored, and clearing them locked that admin out of the admin surface on the very next request (403) until they were put back; an unknown role slug is refused. The last active super admin cannot drop their own role or disable their own account. Disabling another account returned 204, killed its token immediately (401) and revoked its sessions; reactivating restored it. Clearing an authenticator removed the secret, the recovery codes and the sessions, and that account's next sign-in went to the enrollment screen with its password still working. Every change appears in the audit log naming the admin who made it, and the log outlives a deleted account |
| Super-admin site in a real browser | **works** — the whole staff sign-in was walked at `localhost:3002`. An **ordinary administrator** was turned away after completing MFA with "That account does not have platform administration access", and no session cookie was kept: `/overview` sent them back to sign in. The super admin then signed in and saw Overview (34 businesses, 5 owner accounts, 3 admin accounts, 31 live / 2 draft / 1 waiting, all four plans), Admin accounts (three accounts with roles, authenticator state and recovery-code counts, their own row marked "(you)" and without a disable button) and the Audit log (104 entries, newest first, with the entity filters) |
| Card logos and thumbnails, against the running API | **works** — 19 checks: a listing with no media reports `logoUrl: null`; after an upload the card carries the logo and the first photo; the thumbnail follows a reorder; a hidden logo is left out |
| Media reordering, against the running API | **works** — moving the last photo up twice walked it to the front, moving the first one up again was a no-op (204, order unchanged), moving it down put it back, a bad direction was 400, another owner's media was 404, and an anonymous caller 401 |
| Sitemap | **works** — `/api/v1/public/sitemap` returned 31 live listings, 30 locality + category pages and 151 category pages; `/sitemap.xml` rendered 214 URLs with `lastmod` on the listings. A listing set to `suspended` disappeared from it and came back when set live again. `robots.txt` now names the sitemap and disallows `/onboarding` |
| Review moderation and listing suspension, against the running API | **works** — 27 checks: a password alone yields only a stage token; enrollment creates the session and ten recovery codes; an admin token is refused by an owner route; a pending review reaches the queue and nothing is public before a decision; approving publishes it (average 4.0, reviewer by first name) and a second decision is 404; suspending needs a reason, takes the page to 404 and removes it from search, cannot be repeated, and reinstating clears the note and brings it back; both wrote audit rows |
| Abuse reports and favourites, against the running API | **works** — 27 checks: a visitor with no account can report and the row carries no user; a signed-in reporter is recorded; an unknown reason, "other" without details, and a listing that is not live are each refused; the per-subject limit stops the fourth report; the queue refuses anonymous callers, names the business for both kinds of subject, and a closed report cannot be reopened; an approved review can be reported and a pending one cannot; favourites need a sign-in, saving twice is one row, a suspended favourite is kept but marked unavailable, and unsaving something not saved is still 204 |
| Reporting and saving in a real browser | **works** — an anonymous visitor opened "Report a problem", chose a reason and got "Thank you. A moderator will look at this listing.", and the row appeared in the database with no user attached. In the admin site the whole MFA sign-in was walked again (password → setup key → ten recovery codes → queue); the report showed in **Reports** naming the business, and "I dealt with it" closed it. A pending review showed in **Reviews** with the reviewer's number masked (`+91******5503`), and approving it from the UI published it (average 5, reviewer shown as "Browser"). On the public site, Save moved the listing into **Saved businesses** and pressing it again removed it |
| `database/checks/media_smoke.sql` | **passed** (10 assertions, rolls back) — the free default, the four plans, that no plan grants verification, that the allowances are still flagged provisional, an unknown plan refused, a duplicate storage key refused, the kind / size / dimension constraints, the quota counting visible media only, and the cascade when a listing is deleted |
| V0008 applied to a **brand-new** database | **passed** — the whole migration chain plus the seeds ran into an empty database and `media_smoke` passed there, which is how the dimension-constraint bug below was proved fixed rather than patched only in the dev database |
| Reference seed `R004_plans.sql` re-applied | **passed** — a second and third migrate changed nothing, and an allowance marked `media_limits_confirmed` survived the re-seed untouched (the seed updates only name, price and sort order) |
| Media against the running API, with Azurite | **works** — 25 checks: anonymous refused (401); another owner's listing is "not found" for both reading and uploading; the Free plan refuses a photo and **records nothing**; Basic accepts a photo, stores it under a random key with the sniffed content type and the dimensions read from the file, and Azurite serves the exact bytes back; **an executable renamed `.png` is refused (415)**, and so is a PNG renamed `.mp4`; Basic refuses a video and a second logo; the fifth photo is refused once four are used; delete returns 204, removes the blob too, and a second delete is 404; a freed slot can be used again; an unknown kind is 400. On Advanced, a video is accepted, a second one too, and a third refused |
| Media in a real browser | **works** — the owner's "Photos and video" screen for a listing on Advanced showed the plan name, the "not final yet" notice and 0 of 1 / 0 of 4 / 0 of 2. Uploading through the form moved it to "1 of 4 used" with the file served from Azurite (`naturalWidth` 64, so it really loaded), and an executable renamed `.png` came back as "Photos must be JPEG, PNG or WebP." with the count unchanged. On the public listing page the logo replaced the monogram and the gallery rendered both photos, with their URLs also in the `LocalBusiness` `image` array |
| `database/checks/review_smoke.sql` | **passed** (9 assertions: pending on arrival, one per person, every CHECK constraint, average over approved rows only, a decided review cannot be re-decided, cascade) |
| Reviews against the running API | **works** — anonymous refused; validation; **an owner cannot review their own business (403)**; a duplicate is refused by the constraint (409); nothing public until approved (`average: null`, not 0); the admin queue, approve, and a second decision answering 404; an audit row written |
| Reviews on the public page | **works** — average 4.0, the reviewer shown by first name only, and a sign-in prompt for an anonymous visitor |
| `database/checks/enquiry_smoke.sql` | **passed** (isolation, the ownership-scoped UPDATE, all four CHECK constraints, cascade on listing delete) |
| Enquiries against the running API | **works** — validation and normalisation, 404 for a listing that is not live, two real owners proving one never sees the other's enquiries (and a cross-owner status change answering 404, not 403), status filters, and the per-IP-per-listing daily cap |
| Enquiries in a real browser | **works** — sent from a listing page with the form replaced by a confirmation; the rate-limit message rendered when the cap was hit; the owner's inbox showed it, and "Mark replied" persisted and cleared the unread badge |
| `database/checks/admin_mfa_smoke.sql` | **passed** (7 assertions, rolls back) |
| Admin MFA against the running API | **works** — a password alone returns only a stage token and **401s on `/api/v1/admin/listings`**; enrollment, TOTP verification, the drift window, replay refusal, recovery-code single-use and lockout after five wrong codes were each exercised |
| Admin MFA in a real browser | **works** — first sign-in walked password → authenticator setup → recovery codes shown once → moderation queue; signing out and back in asked for a code and returned to the queue, with moderation unaffected |
| TOTP agreement with an independent implementation | **passes** — the RFC 6238 published test vectors in unit tests, and a separately written Node generator produced codes the API accepted |
| Owner dashboard in a real browser | **works** — signed in by OTP, every sidebar item reaches a working page with the correct active state, Overview's figures and 3-of-6 checklist match the API exactly, and editing the name saved and was reflected everywhere |
| `PUT /api/v1/me/profile` against the running API | **works** — 401 anonymous, 400 with field errors on bad input, 200 on a valid change, and an `owner.profile_updated` audit row written |
| Owner routes refuse anonymous callers | **passes** — `/account`, `/account/listings`, `/account/listings/new`, `/account/profile` and `/account/settings` all answer 307 to `/login?next=…`; `/api/v1/me`, `/me/overview` and `/me/listings` all answer 401 |
| Dashboard responsive check | **passes** — no horizontal overflow at 320, 375, 768, 1024 or 1440; sidebar from 1024, drawer below it with all six items; **no console errors** |
| Category dropdown interactions in a real browser | **works** — hover opens; clicking a hover-opened panel keeps it open (it pins) instead of closing; a second click closes; the pointer travels trigger → panel without closing; leaving closes an unpinned panel; Escape closes and returns focus; Tab from a trigger lands on the first link inside its panel |
| Chevron rotation and panel animation | **works** — `rotate: 180deg` when open over 150ms, panel animates in over 140ms, and the `prefers-reduced-motion` rule is present in the stylesheet |
| Nav fits its own box, measured at four widths | **passes** — `nav.scrollWidth <= nav.clientWidth` and no collision with the sign-in button at 1024, 1280, 1536 and 1850; page overflow is −15px (scrollbar slack) throughout, and 0 at 375 |
| Popular-category icons | **render** — seven inline SVG icons on the homepage, no new dependency, no horizontal overflow at 375px |
| Mobile category drawer | **works** — tap opens the drawer, tap expands a category, `aria-controls` resolves, no horizontal overflow at 375px |
| `database/checks/owner_overview_smoke.sql` | **passed** (5 assertions, rolls back) — includes that one owner's dashboard figures never count another owner's listings |
| `GET /api/v1/me/overview` against the running API | **works** — 401 anonymous; a verified-but-unregistered owner sees all zeros and 0/6 steps; immediately after registering, 1 draft and 3/6 steps, matching the unit tests |
| `npm run build -w apps/main-website` with the API stopped | **passes** — this is what CI does, and it was **failing** until the fix noted under "Known limitations" |
| `database/checks/search_smoke.sql` | **passed** (10 assertions, rolls back) |
| `database/checks/locality_search_smoke.sql` | **passed** (9 assertions, rolls back) |
| Locality lookup against the running API | **works** — `gachi`→Gachibowli, `patan`→Patancheru (a misspelling reached through trigram matching), `kphb`→KPHB Colony; a typed `%` matched nothing instead of everything; one letter and a point outside the world were both refused with 400; `nearest` resolved HITEC City's own coordinates to HITEC City |
| Location autocomplete in a real browser | **works** — typing six characters sent exactly **one** request (debounced), arrow keys and Enter chose a suggestion, Escape closed the list, and `aria-activedescendant` tracked the highlighted option. Unconfirmed typed text submitted `locality=` **empty**, so it never became a filter; a chosen suggestion submitted its slug and came back named in the field. With geolocation stubbed to a point 53 km out, "use my current location" named Medchal and said how far away it was. Every failure state was exercised and handled in place, with no console errors: permission denied, geolocation missing from the browser, the naming lookup returning 502, the suggestion lookup failing (the list says so), no match at all, and a **stale answer** — a deliberately slow first response arriving 1.5 s after a newer one did not replace it. Reloading a full `/search` URL restored the same filters, the same area name from its slug, and the same result count |
| `database/checks/admin_moderation_smoke.sql` | **passed** (21 assertions, rolls back) |
| `database/checks/onboarding_smoke.sql` | **passed** (8 assertions, rolls back) |
| Owner registration against the running API | **works** — a new number verified an OTP, registered, and got one account with one draft listing built from the chosen locality's centre point and the verified phone. Repeating the request returned the same listing and did not overwrite the profile; **five simultaneous requests produced one 201 and four 200s, and exactly one business and one listing** |
| Owner registration in a real browser | **works** — a new number was sent to `/onboarding` after verifying, registered, and landed on the dashboard with its draft listing. A registered owner signing in again went straight to the dashboard, and `/onboarding` redirects away once registration is done |
| Search in a real browser against the seeded database | **works** — see below |
| The whole workflow in a real browser against the seeded database | **works** — owner signed in by OTP and submitted a listing, it appeared in the pending queue, an admin approved it and the public page went from "not found" to live within seconds; a second listing was rejected with a reason, stayed unpublished, and the owner saw the reason on their listings screen |
| Admin-added and admin-edited listings against the running API | **works** — a hand-added listing is stored as `source = admin` with no owner and goes live at once; editing changed the details and left the status alone; both wrote audit rows |
| Permission separation against the running API | **works** — an admin holding only `listings.view` + `listings.create` got `403` on approve, reject and edit, and their new listing went to the review queue instead of going live |
| Redesigned home page in a real browser | **works** — every section renders from real API data (17 category parents, their real sub-categories, published listings). The mega-menu opens on click, lists a parent's real sub-categories and navigates: "Dentists" landed on `/search?category=dentists` with results. Keyboard path checked: Enter opened the panel, Tab moved to "All Home Services" then "Plumbers", Escape closed it and returned focus to the button. The ☰ menu at 375 px listed all 17 parents and expanded to the real links. The hero search box still submits (`dentists` → `/search?q=dentists&category=dentists`) and the locality combobox still suggests (`gachi` → Gachibowli). No console errors on a clean load |
| Redesigned search results in a real browser | **works** — all against the seeded database. Filters combine: `q=sample` + `category=plumbers` + `locality=kukatpally` + `sort=name` returned **1 business**, and every control still showed its value after a refresh, including the area name resolved back from its slug. Removing a filter chip went from `/search?category=dentists&q=sample` to `/search?category=dentists` and the count changed with it; **Back** and **Forward** both restored the right results. Paging: 31 listings over 2 pages, page 2 held the remaining 11. Empty search, past-the-end page (`page=99`) and **a real API failure** (the API was stopped, then restarted) each showed their own panel, the failure one as `role="alert"` with the filters still usable. The locality field starts on "Choose a location", `kukat` suggested Kukatpally, choosing it submitted `locality=kukatpally` while **typed-but-unchosen text submitted `locality=` empty**, and the clear button emptied both the field and the hidden slug. No console errors |
| Redesigned login and onboarding in a real browser | **works** — the whole OTP journey was walked twice against the running API. A number that had never signed in requested a code, the code step showed the number masked (`90****0123`), the code verified and the new owner landed on `/onboarding`; the form listed the **103 real localities and 134 real sub-categories** from the API, and submitting it created the account and went to `/account/listings?welcome=1` with the draft listing shown. Visiting `/onboarding` again redirected to the dashboard, and **signing out and back in with the same number went straight to the dashboard**, not to onboarding. Both failure paths were exercised: a 3-digit number was refused with "Enter a valid 10-digit Indian mobile number", and a wrong code with "The code is invalid or has expired", each staying on the right step. No console errors |
| Redesigned login and onboarding at four widths | **works** — no horizontal overflow at 320, 375, 768 or 1440 px; the marketing panel is hidden below 1024 px so the form has the screen to itself |
| Redesigned listing detail in a real browser | **works** — a real listing rendered with its breadcrumb, monogram, description, actions and facts panel. Every crumb navigates: the area crumb went to `/search?locality=beeramguda`, the category crumb and the "More …" link both went to `/hyderabad/madhapur/plumbers`. The **D4 redirect still holds**: `/hyderabad/madhapur/electricians/ravi-kumar-plumbing` landed on `/hyderabad/madhapur/plumbers/ravi-kumar-plumbing`, and an unknown slug gave the "Not found" page. The canonical link and the `LocalBusiness` structured data are both still in the markup. A listing with no WhatsApp number and no website showed four facts instead of six, with nothing empty. No console errors; no overflow at 320, 375 or 1440 px |
| The optional WhatsApp and website fields, end to end | **works** — after one dev sample listing was given both (`D001_sample_listings.sql`), `Sample Brew and Bites Cafe Madhapur` showed **six** facts instead of four, and its WhatsApp link came out as `https://wa.me/919999010025` (the `+` and spacing stripped) with the website carrying `rel="noopener noreferrer nofollow"`. The same branch was checked in the other two places that render it: the `/search` result card and the locality + category page card, where **only that one listing of the two shows a WhatsApp button**, so the condition is genuinely conditional |
| Redesigned owner screens in a real browser | **works** — the whole owner journey was walked on the redesigned screens against the running API. A second new number registered through `/onboarding`, landed on the dashboard, opened the listing, saved an address, pincode and description ("Changes saved."), then submitted for review: the page returned to `/account/listings?submitted=1`, the badge changed to **In review** and the counts moved from `Drafts 1` to `In review 1`. The counts are derived from the listings the API returns, so they follow the real data. Validation still reports properly through the shared `Field`: a 2-digit pincode produced "Enter a 6-digit pincode." with `aria-invalid="true"` and `aria-describedby="pincode-error"`, under the banner "Please fix the fields marked below." The area is shown locked on the edit form and selectable only when adding. No console errors; no overflow at 320, 375 or 1440 px |
| OTP rate limiting, hit by accident | **works** — after five code requests for one number within the hour the API refused with "Too many code requests. Please wait a little and try again." (`MaxOtpPerPhonePerHour = 5`). The per-IP allowance is 20/hour, so testing continued on a second number |
| Redesigned search results at five widths | **works** — no horizontal overflow at 320, 375, 768 or 1440 px; the results grid is one column on a phone, two at 768 px and three at 1440 px |
| Home page layout at seven widths | **works** — no horizontal overflow at 320, 375, 768, 1024, 1280, 1366, 1440 or 1920 px. The category bar appears at 1280 px and above; below that the same tree is behind the ☰ toggle |

The moderation walk-through was done against a temporary listing that was deleted afterwards, so the
dev data is unchanged. Two staff accounts exist **in the local database only**:
`dev.admin@hyderabadlinks.local` (role `admin`) and `super.dev@hyderabadlinks.local` (role
`super_admin`, added on 2026-10-20 to exercise the super-admin site). Both share one password, which
is not recorded anywhere in the repository — reset either with the `create-admin` command whenever
you need it. `Auth:TotpEncryptionKey` is regenerated on every development start, so an enrollment
only survives while the API keeps running; signing in again simply walks the setup screens.

## What works today

**Public site (`apps/main-website`)**
- **Design system (redesign pass 1).** The palette, type and spacing now come from tokens in
  `src/app/globals.css` (`@theme`), taken from the owner's reference build: teal `brand-700`, a cyan
  `brand-400` accent, `ink` / `muted` / `line` neutrals and `night` for the dark band. The four token
  names the pre-redesign components already used (`brand-50/100/700/900`) were kept, so the search
  filters, listing cards and owner screens picked up the new palette without being edited.
  Reusable pieces live in `src/components/ui/`: `Button`/`ButtonLink` (primary, ghost, cta),
  `SectionHeading` (light and dark), `CategoryCard` and `BusinessCard` (the circular monogram card
  with the name ribbon). `SiteChrome.tsx` holds the teal utility bar, the main header and the
  footer; `CategoryNav.tsx` holds the mega-menu. All of it is page-agnostic, so the search results
  page can adopt it next.
- **Home page, redesigned to the reference.** Announcement strip, hero with the search box and
  popular-category shortcuts, "Most Searched Businesses & Services" built from the real category
  tree, a dark band of circular business cards built from real published listings, and the
  business-owner call to action. No mock data and no hard-coded categories anywhere on it.
- **Category mega-menu (`src/components/CategoryNav.tsx`).** The header navigation is the real
  two-level tree from the API. Five parents sit on the bar and the remaining twelve are behind
  "More"; each opens a panel of that parent's real sub-categories plus an "All <parent>" link, and
  every entry navigates to `/search?category={slug}`. The triggers are disclosure buttons rather
  than hover targets, so the panels are reachable by keyboard and usable on touch: Enter or Space
  opens, Tab walks into the panel, Escape closes and returns focus, and a click outside closes.
  Below 1280 px the same tree stacks behind the ☰ toggle. The tree is fetched on the server in
  `SiteHeader` and passed in, so the browser still never calls the API.
- **Search (`/search`) — database-backed.** Matches business names and
  descriptions using SQL Server full-text search, tolerates misspellings
  through trigram similarity, and matches service words through the
  `category_search_terms` table. Filters by category (a parent slug also
  matches its sub-categories) and by proximity. The API can also filter by locality, including
  listings that merely *serve* that area, but **the website no longer uses it as a filter**: since
  2026-10-26 a chosen area supplies a point and orders the results by distance from it, because on
  a directory this size a hard area filter almost always returns nothing. Sorts by relevance,
  distance or name.
  Results are paginated with the total number of matches. Every filter lives
  in the URL, so results are shareable. Empty, error and past-the-end-page
  states are all handled.
- **Search results, redesigned to the reference (pass 2).** A page heading that names what was
  searched and where, the filter panel, then the results as `ListingCard`s in a one / two / three
  column grid. New on this pass: **active filter chips**, one per filter in force (keyword,
  category, area, "near my location", sort), each an ordinary link back to the same search minus
  that one parameter — so removing a filter needs no JavaScript, keeps the other filters, returns
  to page 1 and leaves a normal history entry. Removing "near my location" also drops the distance
  sort, which cannot outlive the coordinates it sorts by. The empty, error and past-the-end states
  are now the shared `EmptyState` panel, and the empty one offers "List your business".
  `ListingCard` was restyled rather than replaced, so the locality + category SEO pages picked up
  the same card. `src/app/search/loading.tsx` shows a skeleton of the real layout while the server
  fetches, announced to screen readers as "Searching for businesses…".
- **Location autocomplete (`src/components/LocalityCombobox.tsx`).** The home page and the search
  filters share one accessible combobox: type part of an area name and choose from suggestions
  (debounced ~250ms, with stale answers dropped so a slow earlier request cannot overwrite a newer
  one), or press "use my current location" to have the coordinates named. Full keyboard support and
  loading, empty and error states. **Only a chosen suggestion becomes a filter, and only as its
  slug** — text that was merely typed is never sent as a locality, so results never quietly come
  from an area the visitor did not pick. Geolocation is asked for on click and never on page load.
  It goes through two route handlers under `src/app/api/localities/`, because this lookup happens
  while the visitor types and so cannot be done during server rendering; the browser still never
  touches the API directly.
- Area + category pages (`/areas/{locality}/{category}`): real listings within 8 km, closest first,
  paginated, with `ItemList` structured data and a canonical URL. Areas with no listings are marked
  `noindex` so the site does not publish thin pages.
- Listing detail pages with the correct record, structured data and canonical URLs.
- **Listing detail, redesigned to the reference (pass 5) — with today's fields only.** A breadcrumb
  that follows the URL's own segments (Home → area → category → this business, every crumb a page
  that exists), then the business card: monogram, name, category and area, description, the Call /
  WhatsApp / Directions actions, and a facts panel. The facts are built by `factsFor()`, which adds
  a row only when the API returned something for it, so a listing without a WhatsApp number or a
  website simply has fewer rows rather than empty ones. The reference's rating, opening hours,
  services list, languages spoken, contact person, social links and logo are **left out**, because
  none of them have tables — `factsFor()` is the one place to extend when they do. The owner's
  disclaimer from the reference is kept. The D4 canonical-category redirect, the canonical URL and
  the `LocalBusiness` structured data are unchanged.
- Owner screens: phone-OTP sign-in (`/login`), then `/account/listings` to create and edit
  listings. **Saving is what sends a listing to review** — a complete listing is created as
  `pending_review` and every later edit returns it there, including an edit to a live one, which
  leaves the public site until a moderator approves the change.
- **Owner screens, redesigned to the reference (pass 4).** `/account/listings` now opens with four
  counts — Live, In review, Drafts, Needs changes — worked out from the listings the API returns,
  then the listings themselves as cards with their status badge, the reviewer's reason when there
  is one, and the actions. The prototype's dashboard also shows Active Blogs, Inactive Blogs and
  Total Views; those are **not** copied, because nothing in this database can ever make them
  non-zero. The add and edit pages share one page header, and `ListingForm` now uses the shared
  `Field`, so the owner form, the onboarding form and the search filters label and describe their
  controls the same way. **No owner logic changed**: the server actions, ownership checks and the
  draft → review → published flow are untouched.
- **Owner registration (D24).** A phone that has never signed in before is sent to `/onboarding`,
  which collects name, business name, email, locality and primary category, then creates the
  profile, business, ownership row and first draft listing in one transaction
  (`POST /api/v1/me/onboarding`). It is idempotent: the user row is locked for the transaction,
  the profile update is guarded by `name IS NULL`, and a repeat returns the existing listing
  rather than making a second one. `GET /api/v1/me` reports `needsOnboarding`, so the rule lives
  in the API rather than in each website. A rejected listing shows the reviewer's reason, so the owner knows what to
  change; submitting again clears it.
- **Login and onboarding, redesigned to the reference (pass 3).** Both now use the shared
  `AuthLayout`: the form on the left, a teal panel on the right, from the prototype's
  `_AuthLayout.cshtml`. The sign-in card keeps its two steps — number, then code — with the number
  masked on the code step (`90****0123`) and the code box centred and letter-spaced as in the
  prototype. The onboarding form is the same five fields, now built from the shared `Field`
  component so the label, help text and error are wired to the control consistently. **No
  authentication logic changed**: the server actions, the OTP flow, the session cookies and
  `needsOnboarding` are untouched; this pass is presentation only.
- `/api/revalidate`: lets the admin site refresh a public page the moment a listing is approved,
  instead of waiting out the 60-second cache window. Off unless `REVALIDATE_TOKEN` is configured.

**API (`backend/BusinessDirectory.Api`)**
- `/health/live`, `/health/ready`, `/api/v1/public/meta`.
- Public: `/cities`, `/cities/{city}/localities`, `/categories`,
  `/listings/search`, `/listings/nearby`, `/listings/{city}/{locality}/{slug}`.
- Public locality lookup, for the autocomplete: `/localities/search?q=&city=&limit=` ranks names
  starting with what was typed above names containing it, and trigram similarity below both so a
  misspelling still lands; `/localities/nearest?lat=&lng=` resolves coordinates to the closest
  known locality and says how many metres away it is. Both use indexes the schema already had
  (`localities_name_trgm_idx`, `localities_center_gix`), so neither needed a migration — and
  nearest stands in for a paid reverse geocoder while D14 is open.
- Owner auth: OTP request/verify, refresh, logout. Short-lived JWT plus a rotating refresh token.
- Owner listings: list, create, read, update — all ownership-checked server-side. A complete listing
  is created as `pending_review` and every later edit returns it there, so nothing reaches the
  public site without a moderator seeing it.
- Security baseline: security headers, deny-by-default CORS, per-IP rate limiting, stricter
  database-backed OTP limits, generic error responses, startup refusal of wildcard CORS outside
  Development.

**Admin site (`apps/admin-website`) — listing moderation, end to end**
- Staff sign-in at `/login` (email + password). No sign-up: accounts are created by the CLI bootstrap.
- `/listings`: the moderation queue, filtered by status, `pending_review` first and oldest-first,
  paginated, with the total of all matches.
- `/listings/{id}`: everything a reviewer needs (contact details, map point, who submitted it, the
  last decision) plus Approve and Reject with a reason the owner will read. Approving publishes the
  listing immediately; rejecting sends it back to the owner, who can edit and resubmit.
- `/categories` and `/locations`: the taxonomy an admin may manage (`taxonomy.manage`). A slug is
  never editable after creation, because public URLs are built from it; retiring a row sets
  `is_active = 0`, and delete is offered only for a row nothing points at. Adding and correcting
  **listings** moved to the super-admin site on 2026-10-26: reviewing and writing are different
  jobs.
- The session lives in httpOnly cookies on the admin site's own origin, and `proxy.ts` swaps an
  expired access token for a fresh pair — the same scheme as the public site.

**API — admin surface**
- Admin auth: `POST /api/v1/auth/admin/login|refresh|logout`. PBKDF2-SHA256 passwords, lockout after
  5 wrong attempts for 15 minutes, one generic failure message, and a rotating refresh token whose
  reuse revokes the whole family.
- Moderation: `GET /api/v1/admin/me`, `GET /listings`, `GET /listings/{id}`,
  `POST /listings/{id}/approve`, `POST /listings/{id}/reject`, `/suspend`, `/reinstate`, and
  `POST /listings/{id}/alerts`. See `docs/api-specification.md`.
- **Writing a listing is not on this surface.** `POST /listings` and `PUT /listings/{id}` are absent
  from `/api/v1/admin` rather than refused, and `listings.create` and `listings.edit` are
  super-admin permissions that `Authorize()` will not accept here even for an account that holds
  them. An integration test asserts those routes answer 404 or 405, so they cannot quietly
  reappear.
- Admin tokens carry the audience `admin` and are validated by their own authentication scheme, so an
  owner token never reaches an admin route (and vice versa). Permissions are read from the database on
  every request — removing a role or disabling an account takes effect on the next call, which was
  checked against the running API.
- Ordinary admin permissions are kept apart from super-admin ones in code
  (`Auth/AdminPermissions.cs`): a permission reserved for the super-admin surface is refused on
  `/api/v1/admin` even to someone who holds it.
- Every decision writes to `audit_logs` in the same transaction as the change.

**Database** — migrations `V0001`–`V0004`: cities, localities (PostGIS), categories, slug history,
users, businesses, business members, listings (PostGIS + full-text + trigram indexes), listing
categories and service areas, OTP challenges, user sessions, admin users and sessions, roles,
permissions, audit logs. Reference seeds hold real Hyderabad localities and categories; dev seeds
hold 30 clearly labelled sample listings. One of them, `sample-brew-and-bites-cafe-madhapur`, also
carries a WhatsApp number and a website (`https://example.com/...`, a reserved documentation
domain), added on 2026-10-18 so the optional WhatsApp and website branches on the detail page and
the result cards can actually be seen while developing. It is a re-runnable `UPDATE` at the end of
`D001_sample_listings.sql`, so `npm run db:seed-dev` stays safe to repeat.

### Header category navigation

Seven real top-level categories sit on the bar, with an **All categories** panel listing all
seventeen. Nothing is hardcoded and the reference's wording ("Food", "Stays") was deliberately not
adopted — see D22's sibling decision below.

- **Hover and click coexist.** A panel opened by hover is *unpinned* and closes when the pointer
  leaves; clicking *pins* it so it stays. Without that distinction a click on an already-hovered
  trigger reads as "toggle" and shuts the panel the hover just opened, which makes clicking look
  broken — that bug was hit once already and the `pinned` flag is what prevents it.
- **The pointer can travel from trigger into panel** because each panel is a DOM child of the same
  wrapper as its button, so `onMouseLeave` does not fire on the way. A 120ms close delay absorbs
  the hairline gap. **That DOM order is load-bearing** for the keyboard too: Tab from a trigger
  lands on the first link inside its own panel.
- SVG chevron rotating 180° in 150ms; panel fades and rises 6px over 140ms; both disabled under
  `prefers-reduced-motion`, which now also turns off the page's smooth scrolling.
- `aria-expanded` and `aria-controls` on every trigger, desktop and mobile.

**The nav now appears from 1024px**, not 1280px. It was previously hidden entirely on 1024–1279px
laptops, which is a very common width. Narrower screens show fewer shortcuts — four up to 1535, six from 1536, seven past about 1800 — and
"All categories" always lists every parent, so nothing is ever unreachable.

**The measurement that matters here is not page overflow.** The nav is a flex item between the brand
and the sign-in button, and its content can overrun that box while `document.scrollWidth` stays
clean, which shows up as the nav colliding with the sign-in button rather than as a scrollbar.
Checking page overflow alone passed at every width while the nav was in fact 59px too wide at 1024
and colliding at 1280 and 1536. The real test is `nav.scrollWidth > nav.clientWidth`, plus comparing
the last trigger's right edge with the sign-in button's left edge. Re-run that at 1024, 1280, 1536
and 1850 after touching the slot counts, the type scale or the gaps.

### Business owner dashboard

The owner area at `/account/*` now has a real shell: a sidebar from 1024px, a drawer with the same
six items below that, active-navigation states, and a bar showing who is signed in. It stays inside
`apps/main-website` — there is no separate Business Owner application and none is needed, exactly as
the owner's own live site serves theirs from `/BO/` on one domain.

Sidebar: Overview, My Listings, Add New Listing, Enquiries, Saved, Plans & Payment, Business
Profile, Account Settings. Every figure on it is counted from that owner's own rows through
`business_members`, so one owner's dashboard can never show another's. **Listing views are
deliberately absent** — no table records them, and the brief forbids inventing figures.

- **Overview** (`/account`) renders `GET /api/v1/me/overview`: total, live, in review, drafts and
  needs-changes counts, a suspended card only when there is one, and the six-step completion
  checklist with a progress meter. An owner with no listings gets an empty state with a working
  "Create your first listing" action. **No views, leads, ratings or growth figures** — no table
  records them, and the reference dashboard's "Active Blogs", "InActive Blogs", "Total Views" and
  notification badge were left out for that reason.
- **Business Profile** (`/account/profile`) edits the owner's name and email, and lists their
  businesses with status and links into the listing editor. Business-level details live on a
  *listing*, so this page links to that editor rather than duplicating it.
- **Account Settings** (`/account/settings`) shows the verified number, name and email, explains the
  no-password model, and signs out through the existing server action that revokes the refresh
  token. No password, email-login or delete-account controls, because none exists.

**`PUT /api/v1/me/profile` is new, and needed.** Onboarding sets the name and email once and is
guarded by `name IS NULL` so a repeated registration cannot overwrite a profile — which also meant
an owner could never correct their own name. No migration was required: `users.name` and
`users.email` already existed. The phone number is not editable there; it is the identity the OTP
verified, and changing it would mean re-verifying.

**A Next.js detail worth remembering:** saving the profile needs *both* `revalidatePath("/account",
"layout")` and a redirect. The owner's name also shows in the dashboard bar, which lives in the
layout above the page; without the revalidate that bar keeps the old name even after a redirect,
because the layout stays in the client router cache. This was observed, not assumed.

### Admin MFA (D28–D31)

TOTP MFA is **mandatory** and enforced structurally rather than by a check in a handler. A correct
password returns only a short-lived token on a *different audience* (`admin-mfa`, or
`admin-enroll` for an admin with no authenticator yet), and the admin bearer scheme validates the
audience, so that token fails on every real admin route. The `admin_sessions` row, the access token
and the refresh token are created **only** by the MFA step, which stamps `last_mfa_at`; refresh
carries that forward and refuses a session that lacks it.

Both existing admin accounts are unenrolled, so each will be taken through authenticator setup on
its next sign-in. That is the intended path — there is no way to skip it.

- Hand-written RFC 6238 TOTP and RFC 4648 Base32, no new dependency, both checked against the
  specifications' own published test vectors.
- The secret is sealed with AES-256-GCM under `Auth:TotpEncryptionKey`; a tampered row fails to
  open rather than decrypting to rubbish.
- Ten recovery codes, shown once, stored only as hashes, spent by an `UPDATE` that matches only an
  unused row so a race cannot spend one twice.
- Wrong codes count against the same lockout allowance as wrong passwords.
- The admin website now has the matching stages: password → code (with a recovery-code toggle), or
  password → authenticator setup → recovery codes → in.

**Two bugs found and fixed on the way, one of them pre-existing:**

1. **Admin lockout never worked.** `make_interval(mins => …)` takes an integer, and the existing
   code passed a double, so Postgres could not resolve the function: *every wrong admin password
   answered 500 instead of 401, and no account was ever locked.* It had no test because the
   integration tests run without a database. Now fixed and verified: five wrong passwords lock the
   account.
2. **Replay protection was not exact.** Deriving the spent TOTP step from `last_mfa_at` lets a code
   accepted from the *next* step — which the drift window allows — be replayed, because that code
   belongs to a later step than the completion time. Migration **V0005** adds
   `admin_users.totp_last_step`, recording the step the verification itself matched.

**Still not built:** MFA re-entry before individually sensitive actions (MFA gets you a session; a
live session is not challenged again), and any endpoint to change or reset an authenticator. An
admin who loses both authenticator and recovery codes currently needs a database intervention.

**Local development caveat:** in Development a missing `Auth:TotpEncryptionKey` is generated
randomly at startup, so **restarting the API makes every enrolled secret undecryptable** and admins
must re-enroll. Set the variable to a fixed base64 value locally if you want enrollment to survive
restarts.

### Customer enquiries (V0006)

The directory's core function now leaves a record. Call and WhatsApp reach the owner but log nothing,
so a missed call was a lost customer. An enquiry is a row the owner can work through.

- `POST /api/v1/public/listings/{city}/{locality}/{slug}/enquiries` — public, no account. Accepts
  only **live** listings, normalises the phone to E.164 and lowercases the email to match the CHECK
  constraints, and is capped at 10 per IP per hour and 3 per IP per listing per day.
- `GET /api/v1/me/enquiries` — the owner's inbox, filterable by status, paginated, with an unread
  count across every listing. Every row is scoped through `business_members`, so an owner can only
  ever see enquiries for their own listings.
- `PUT /api/v1/me/enquiries/{id}/status` — read, replied, closed or spam. The ownership join is
  part of the `UPDATE`, so another owner's id matches no row and answers **404 rather than 403**,
  which tells a prober nothing.
- Public form on the listing page; `/account/enquiries` in the dashboard, which fills in the
  **Leads & Enquiries** sidebar item deliberately left out before the table existed.
- The dashboard overview now reports a real unread count instead of omitting the figure.

**The owner is now notified by email when an enquiry arrives** — see "Notifications" below. In
Development the message is printed to the API console; in any other environment there is still no
provider configured, so the attempt is recorded as a **failed** notification rather than reported as
sent. No SMS is sent for an enquiry.

### Customer reviews and ratings (V0007, decision D11)

D11 required phone-verified reviewers plus moderation, and both are enforced rather than assumed.

- `POST /api/v1/me/reviews/{city}/{locality}/{slug}` — signed in only. Checks `phone_verified_at`,
  refuses a reviewer who **manages that business** (the most obvious way to manufacture a rating),
  and relies on a unique constraint for one-review-per-person so a double submit or a race cannot
  produce two. Returns **202, not 201**: the review exists but nothing is public yet.
- `GET /api/v1/public/listings/{city}/{locality}/{slug}/reviews` — approved reviews and the
  average, computed over exactly the set the visitor can read, so the number and the list cannot
  disagree. The average is `null` when nothing is approved, never 0, which would read as "rated
  zero". Reviewers appear by **first name only**.
- `GET /api/v1/me/reviews` — a reviewer sees their own, including a rejection note.
- `GET /api/v1/admin/reviews`, `POST .../approve`, `POST .../reject` — gated on the existing
  `reports.handle` permission, whose seeded description already covers reviews, so **no new
  permission or migration was needed**. Only a *pending* review can be decided, so two moderators
  cannot both record an outcome, and each decision writes an audit row.
- Public reviews section and a submission form on the listing page.

**Not built:** no admin *UI* for review moderation yet — the endpoints exist and are tested, but a
moderator currently needs to call them directly. Abuse reporting (flagging a published review) is
also still absent.

### Listing media and plans (S0005, S0009, S0012, S0016; decisions D32–D34, D48–D49)

Photos, a logo and video for a listing, with the plan's allowance enforced in the API and applied
again at read time.

- **`plans`** holds exactly two rows: **Free** (no media) and **Verified**, ₹399 a year for 10
  photos, 2 videos, 1 logo, 5 links and the badge. `media_limits_confirmed` is true on both — the
  owner settled the structure on 2026-10-25 (D48) and the video count on 2026-10-27 (`S0016`).
  Changing an allowance is still an `UPDATE` rather than a deploy.
- **A listing is Verified only while a paid subscription period covers today.** `listings.plan_slug`
  records what was bought; what is *in force* comes from the `listing_entitlements` view, which
  compares the period with the clock. Nothing stores "expired" and no job sets it, so a lapsed plan
  needs nothing to run in order to lapse.
- **`listing_media`** keeps the metadata; the bytes live in object storage. `storage_key` is unique
  across the table. `dbo.listing_visible_media` (S0012) is the one definition of what a listing may
  show *now*: each kind capped at the plan's current allowance, oldest first, so a downgrade keeps
  an explainable subset rather than an arbitrary one. Media over the allowance is kept and hidden,
  never deleted, so renewing restores everything untouched.
- **`IMediaStorage`** (`Media/`) is the one seam between the API and storage, with two
  implementations: **Cloudflare R2** through the AWS S3 client (D49, the current choice) and
  **Azure Blob Storage** (D33). `Media:Provider` chooses and is inferred when unset. With nothing
  configured the API answers **503 and writes no row**, rather than recording a file it never
  stored, and a provider missing a setting says which one on boot. The API does not create an R2
  bucket, because a new one serves nothing until a domain is bound to it in the dashboard; it lists
  one object at startup to prove the credentials and the bucket instead.
- **`GET|POST /api/v1/me/listings/{id}/media`, `DELETE .../{mediaId}`** — the upload enforces three
  things, each of them in the API and not in the UI:
  - **ownership**, through the same `business_members` join the rest of the owner endpoints use, so
    another owner's listing is "not found" rather than "forbidden";
  - **the allowance**, counted inside the same transaction that inserts the row, with the listing row
    locked first, so two uploads racing cannot both take the last free slot;
  - **what the file actually is**, read from its first bytes (`MediaFile.SniffContentType`). The
    filename and the declared Content-Type are attacker-controlled and are ignored; the stored blob
    name is `listings/{id}/{kind}/{random}`, so nothing the caller sent reaches the path.
  The row is reserved first, the bytes are stored next, and only then is the transaction committed —
  a failure in between rolls the row back, so a gallery never lists a file that is not in storage.
- **Owner screens** — `/account/listings/{id}/photos` for media and `/account/listings/{id}/links`
  for the Verified plan's five links, each showing what the plan allows and what is used, with the
  API's own refusal messages.
- **Public listing page** — the logo replaces the monogram, and photos and video render in a
  gallery. Everything public reads through `listing_visible_media`, so a lapsed or reduced plan
  cannot leak media the listing may no longer show. The photo URLs also go into the `LocalBusiness`
  `image` array for search engines.

**Not built around it:** no cropping, no generated thumbnails, and no sweeper for an orphaned blob.
**Nothing has ever been stored in a real bucket** — no R2 or Azure credentials are configured, so
the whole media feature is unexercised outside Development.

### Logos and thumbnails on the cards

`/api/v1/public/listings/search` carries `logoUrl` and `photoUrl` for every row: the logo, and the
first photo as a fallback. Both exclude hidden media, so a card can never show a file the listing
page itself no longer displays. One endpoint feeds the homepage circles, the `/search` results and
the locality + category pages, so all three gained real logos at once; a business with neither still
shows its monogram.

### Reordering media

`POST /api/v1/me/listings/{id}/media/{mediaId}/move?direction=up|down` swaps one file's position with
its neighbour of the same kind, inside one transaction. A swap rather than a renumbering, so two
owners reordering at once cannot leave a half-numbered gallery; moving the first item up is a no-op
answering 204, not an error. The owner screen shows arrow buttons once there is more than one of a
kind — not drag and drop, which would need far more machinery for an ordering that matters a little.

### Sitemap and robots (SEO)

`/sitemap.xml` on the public site, built from `/api/v1/public/sitemap`: the home and search pages,
every **live** listing with its last-modified date, every locality + category pair that actually has
a live listing, and every seeded category's search page. Suspended, draft, rejected and
pending listings are all absent, because none of them has a page that resolves. The locality pairs
come from the listings themselves rather than from every combination of 103 areas and 134
categories, which would be thin pages by the thousand. `robots.txt` names the sitemap and disallows
the signed-in areas. If the API is unreachable the sitemap falls back to the two fixed pages rather
than answering 500, which some crawlers treat as the whole file being broken.

### Admin moderation beyond approve and reject

- **Suspend and reinstate** (`POST /api/v1/admin/listings/{id}/suspend` and `/reinstate`, decision
  D35). Gated on the existing `listings.review` permission. Suspending needs a reason, which is
  stored in `review_note` so the owner reads it where a rejection reason already appears; the public
  page stops resolving and the listing leaves search immediately. Reinstating clears the note.
  `published_at` is never touched, so a reinstated listing is not mistaken for a new one. Both write
  audit rows, and the admin screen refreshes the affected public pages.
- **Review moderation UI** at `/reviews` in the admin site. The endpoints existed and were tested;
  now there is a queue for them, filtered by waiting / published / rejected, with the reviewer's
  number masked. Rejecting requires a reason, because the reviewer reads it.
- **Abuse reports** (V0009, decisions D36–D37). Anyone may report a listing or a published review,
  with or without an account, and the limits are counted per IP address in the database. A report
  about a review names the business it is on, so the queue always says what is being complained
  about. Closing a report records what a moderator concluded and **changes nothing else**: suspending
  the listing or rejecting the review stays a separate, audited action.

### Favourites

`GET|PUT|DELETE /api/v1/me/favourites/...`, keyed by the slug a visitor already has in the URL, and a
**Saved** screen in the owner dashboard. Private to the person who saved it (decision D38): nothing
public counts favourites and no owner is told who saved their listing. Saving the same listing twice
is one row, enforced by the primary key rather than by a check in the API. A favourite whose listing
stops being live is kept but marked unavailable, and shown without a link, because hiding it would
just look like the site had lost it.

### Platform administration (super-admin, decisions D39–D40, D51)

`apps/super-admin-website` runs on port 3002 and has:

- **Sign-in.** The same staff password and the same authenticator as the admin site, because it is
  the same account. What differs is the token it keeps: only an account holding `admins.manage` is
  issued a **super-admin audience** token, and an ordinary administrator who signs in is told
  plainly that they have no platform access instead of being let into a site whose every request
  would be refused.
- **Overview** — businesses, owner accounts, admin accounts, new enquiries, reviews waiting, reports
  open, and listings broken down by status and by **effective** plan, read through the entitlement
  view so a lapsed subscription is never reported as Verified. Every figure is a count of rows that
  exist; there is no "visits" or "revenue" tile, because nothing records either.
- **Listings** — adding a business by hand, correcting one, archiving and deleting. These moved here
  from the admin site on 2026-10-26. Delete needed care, because every table pointing at `listings`
  cascades, `subscriptions` and `subscription_payments` included.
- **Featured** — the homepage shelf, curated by hand and capped at the eight the homepage shows
  (D51). `featured_at` is both the ordering and the record of when; `featured_by_admin_id` is the
  record of who. `S0017` throws if the admin role is ever granted `listings.feature`.
- **Admin accounts** — the roles each account holds (as tick boxes; saving replaces the set),
  enabling and disabling an account, and clearing a lost authenticator. Disabling also revokes that
  account's sessions, so its existing token stops working on the next request. The API refuses the
  last active super admin dropping their own role or disabling themselves.
- **Audit log** — read-only, newest first, filtered by what was changed or by a particular action.

The two gates are the audience and the permission, both server-side. `AdminPermissions` keeps the
two surfaces' permissions in separate lists and `AdminAccess.Authorize` / `AuthorizeSuper` each
refuse the other surface's permissions, even to an account that holds them; unit tests and
`v0003_smoke` both guard that, the check now naming every permission that must not leak.

**Not there:** creating an account and resetting a password (D40 — both need email), and editing
plans (`plans.manage` is seeded and unused; the `plans` table is edited with SQL, which is what D32
intended).

### Notifications (V0010, decisions D41–D42)

Three events now send an email to the business owner: a **new customer enquiry**, a **listing
approval**, and a **listing rejection**. Nothing else notifies anybody.

**No email provider is configured, and nothing pretends otherwise.** `backend/BusinessDirectory.Api/Notifications/`
holds one `IEmailSender`, exactly mirroring `Auth/ISmsSender.cs`:

- `ConsoleEmailSender` — **Development only.** Writes the recipient, subject and the whole plain-text
  body to the API console. This is how the templates were checked without a single real email
  leaving the machine.
- `UnconfiguredEmailSender` — **everywhere else.** Throws `"No email provider is configured
  (Email:Provider)."` rather than returning quietly, so nothing can report that an owner was told
  something when nobody was.
- **No provider adapter exists.** D14 names Resend as the candidate, but that choice is still
  **unconfirmed** by the owner, so no adapter was written. Adding one is a single class; see
  "Missing credentials and configuration" for the exact keys it needs.

**Sending never fails the request that caused it** (D41). The order is deliberate:

1. The endpoint writes its own work — the enquiry row, or the approve/reject update plus its audit
   row — and, in the *same* transaction, a `notifications` row with status `pending`.
2. It commits.
3. *Then* it tries to send. On success the row becomes `sent` with `sent_at`; on any failure it
   becomes `failed` with the exception type and message, and the request still succeeds.

An enquiry that was recorded matters more than an email that went out. Writing the row first is also
what makes a failure **visible**: without it, an unconfigured provider or a dead API key would be a
silent nothing, and the first person to notice would be an owner wondering why they never hear about
their customers. `V0010` enforces the three states in the schema rather than trusting the API to
remember them — a `pending` row cannot claim attempts, a `sent` row cannot carry an error, a
`failed` row must give a reason and cannot have a `sent_at`.

**Who gets notified.** `OwnerLookup.ForListing` finds the `owner` member of the listing's business
who has an email address. There are three honest ways to have nobody to notify, and all three
record no notification and change nothing: the listing is unclaimed and has no member, the owner
never gave an email address, or what is stored is not an address worth sending to. Plenty of owners
signed in by phone and never typed an email, so this is the normal case, not an error. `manager`
members are not notified — this is the business's own mail.

**The templates** (`EmailTemplates.cs`) render plain text *and* HTML, saying the same thing in both,
with inline styles because mail clients strip stylesheets. They carry only real content: the
business name, the customer's name, number, optional email, their message, and the time in IST. **No
invented statistics and no links to screens that do not exist.** Links are absolute and appear only
when `Email:SiteBaseUrl` is set — `/account/enquiries`, `/account/listings` and the listing's own
public URL, all of which exist. With no site address configured the emails carry no links at all
rather than a relative path a mail client cannot follow. Everything interpolated into the HTML is
escaped, so a customer's message cannot inject markup.

**Address validation** (`EmailAddress.cs`) trims, lowercases and refuses anything with whitespace in
it, which is what stops a stored address smuggling an extra header into a provider's API call. The
pattern matches `EnquiryValidator` and the V0006/V0010 CHECK constraints, so all three agree.

**Not there:** no retry (the table is a log of attempts, not a queue — a `failed` row is for a
person to look at), no SMS notifications, no notification for a review decision, a report outcome,
a suspension or a reinstatement, no digest or preferences, and nothing for the owner to see in the
UI — the only reader of the table today is SQL.

## Not built yet

Ordered by what unblocks the most. The first four need the owner rather than code.

1. **The first super-admin account.** `create-admin` on the command line is still the only way to
   make one, and until one exists on the live database the admin and super-admin sites can only be
   tested as far as their sign-in screens.
2. **A payment provider.** The Razorpay adapter is written, refuses to run unconfigured, and refuses
   a live key without `Payments:LiveModeApproved` (D45, D50). No account exists and no payment has
   ever been taken, so the integration is unverified end to end.
3. **An email provider.** The abstraction, the templates and the recording are built; D14's Resend
   has never been confirmed, so no adapter was written. See "What email still needs, exactly". It
   also holds up the correction-request email (D52) and the payment receipt (`S0013`).
4. **A media bucket.** R2 or Azure (D49). Until one is configured every upload answers 503 and the
   Verified plan's photos, videos and logo cannot be used at all.
5. **Switching on automated migrations.** The deploy workflow now has a gated `migrate` job that
   applies the migrations and the reference seeds before the API ships, but it is **off**: it needs
   a `production-database` environment holding `DATABASE_CONNECTION_STRING`, and the repository
   variable `RUN_MIGRATIONS` set to `true`. Until then every migration is applied by hand, as
   `S0009`–`S0017` were. **It has never run.** The database is on shared hosting rather than Azure
   SQL, so it may only accept allow-listed addresses, and a GitHub runner has no fixed one; if that
   is how it is configured this needs a self-hosted runner, and `npm run db:migrate` from a trusted
   machine stays the fallback.
6. **End-to-end tests.** `tests/e2e/` is empty and Playwright is not set up. Every critical journey
   has been walked by hand in a browser and recorded here; nothing re-walks them.
7. **A nonce-based CSP.** `'unsafe-inline'` on `script-src` is the remaining weakness, and closing
   it means a per-request nonce through middleware and re-verifying every page.
8. **OpenAPI documentation** — the API publishes none, the brief requires it, and
   `packages/api-client` is an empty placeholder waiting for a generated client.
9. **Admin account management** — inviting admins, assigning roles and changing passwords have no
   screens, and an admin who loses both authenticator and recovery codes needs a direct database
   edit (D40: both need email).
10. **Editing plans from the super-admin site.** `plans.manage` is seeded and unused.
11. **Marking a business verified by hand.** `listings.verify` is seeded and unused. The badge now
    comes from a paid period, so a manual grant would be an override of that and needs a rule first.
12. **Branches** — decision D3 models a branch as a second listing; no branch-specific UI exists.
13. **Notification follow-ups** — no retry for a `failed` row, no SMS notifications, nothing for a
    review decision, a report outcome or a suspension, and no owner-facing view of what was sent.
14. **Media housekeeping** — no cropping, no generated thumbnails, and no sweeper for an orphaned
    blob.
15. **Azure infrastructure as code** — `infrastructure/azure/` holds only a README.
16. **A staging API and database.** There is none, which is why preview deployments are deliberately
    left unreachable: a preview pointed at `API_BASE_URL` would talk to the production API and the
    production database. See `REPAIR_STATUS.md`.

## Known limitations in what *is* built

**Media files are not reference-counted.** Deleting a photo removes the row first and the blob
second: if the blob delete fails, the file stays in storage with nothing pointing at it. That is the
deliberate trade — a listing still showing a photo the owner deleted would be worse — but it means a
rare orphaned blob, and there is no sweeper for them yet. The upload path has the mirror case: if the
commit fails after the bytes are stored, the API deletes the blob it just wrote.

**A dimension CHECK that silently accepted bad rows (found and fixed on 2026-10-20).** The first
version of `listing_media_dimensions` read `(width IS NULL AND height IS NULL) OR (width > 0 AND
height > 0)`. With only a width set, the second half evaluates to NULL rather than false, and a CHECK
constraint **accepts** NULL — so a half-measured row would have been stored. `media_smoke.sql` caught
it. The constraint now tests `IS NOT NULL` explicitly, and the fix was proved by running the whole
migration chain into a brand-new database, not only by altering the dev one.


- **The site header fetches the category tree, so `getCategories()` must never throw.** `SiteHeader`
  is an async server component rendered in the root layout, which means every statically prerendered
  page — `/_not-found` included — needs the categories endpoint at build time. This broke
  `next build` with `ECONNREFUSED` whenever the API was not running, and would have broken CI,
  which builds with no API and no database. `getCategories()` now catches a failed fetch and
  returns an empty list. **Anything else added to the root layout needs the same treatment**, and
  `npm run build -w apps/main-website` should be run with the API stopped before trusting a change
  to the site chrome. The empty list is a reachable state, so the pieces that read it degrade
  rather than render empty frames: `CategoryNav` renders nothing at all (so there is no empty
  dropdown and no ☰ button with nothing behind it), and the home page skips both its
  popular-category shortcuts and its whole "Most Searched" section instead of showing a heading
  over an empty grid. Checked by building with the API unreachable: the build succeeds and
  `/_not-found` prerenders as static.

- **The listing detail page shows only what the database holds.** The reference shows a Google
  rating, opening hours, a services list, languages spoken, a contact person, social links and a
  logo; none of those have tables, so on the owner's instruction (2026-10-18) they were left out
  rather than faked or stubbed. `factsFor()` in
  `src/app/[city]/[locality]/[category]/[slug]/page.tsx` is the single place to add them.
- ~~The WhatsApp and Website rows on the detail page have not been seen rendered.~~ **Closed on
  2026-10-18**: one dev sample listing now carries both (see the dev seed note below), and all
  three places that render them were checked.
- **The sign-in and onboarding pages keep the site header and footer**, where the prototype hides
  them and fills the screen. That is deliberate: this is a public directory rather than a
  standalone portal, so someone who lands on sign-in by accident can still get back to the
  listings. It is a one-line change in `AuthLayout` if the owner would rather match the prototype.
- **The prototype's sign-in page rotates three marketing slides in a carousel.** The same three
  messages are shown as a static list instead, because a carousel would mean a JavaScript library
  for decoration alone.
- **The live database holds a handful of test rows** from proving sign-in and the owner journey, all
  listed in `REPAIR_STATUS.md` under "Left behind, needs the owner". There is no local development
  database any more: development runs against the same shared server, which is why
  `npm run db:check` prints the server and database before it does anything.
- **Submitting the search form leaves empty parameters in the URL** (`/search?page=1&q=&category=plumbers&locality=&sort=`).
  That is how a plain GET form behaves, and the page ignores empty values, so the results and the
  filter chips are correct. Tidying it would mean handling the submit in JavaScript, which would
  cost the form its "works with scripts off" property. The chip links, which are the usual way to
  change a filter, produce clean URLs.
- **The category filter on `/search` is still one `<select>` of about 150 options.** It works, it is
  accessible, and it is grouped by parent category, but the header's mega-menu is now the better
  pattern for it.
- **The homepage's Featured shelf is empty until a super admin picks something** (D51). That is
  deliberate: it is a curated list, and `S0017` did not inherit the automatic membership it
  replaced. Trending is computed from enquiries, favourites and approved reviews over 30 days and
  needs no curation.
- **A business card shows its logo when the listing has one**, and a monogram otherwise.
  `initialsOf()` in `src/components/ui/BusinessCard.tsx` draws the fallback, and the card reads
  through `listing_visible_media`, so it can never show a file the listing page no longer displays.
- **The header and footer only link to pages that exist.** `/help`, `/terms` and `/privacy` exist
  now; About, Membership, Contact and the social accounts do not, so they are still left out rather
  than shipped as dead links.
- **The brand is set in type, not a logo.** The reference loads a logo from the live site; this
  repository has no logo file, so `SiteChrome.tsx` draws "Hyderabad **Links**" with a round HL mark.
- **The number of categories on the navigation bar is a fixed five.** Category names come from the
  database, so a much longer name could still crowd the bar at 1280 px. It is checked at seven
  widths with today's names.

- **Full-text search does not stem.** The SQL Server full-text index over `name` and `description`
  matches words as written, so "plumbers" does not reach "plumber" through full-text alone. Trigram
  matching (D42) and the `category_search_terms` table cover most of the gap in practice.
- **`/api/v1/public/listings/nearby` now has no frontend caller.** `listings/search` with
  `sort=distance` does everything it does. The endpoint and its tests remain because the brief wants
  the listings API reusable by other applications. Decide whether to keep it when the API surface is
  reviewed.
- **The search page's category `<select>` lists every category** (~170 options). It works and is
  accessible, but a searchable combobox would be better once there are more categories — the
  locality one in `LocalityCombobox.tsx` is the pattern to copy.
- **Location autocomplete only knows the 103 seeded localities.** Typing an area that is not in the
  dataset finds nothing, and "use my current location" names the nearest one we do have rather than
  where the visitor actually is (it says how far away when that is over 5 km). Extending the
  dataset — see "Decisions needed" item 6 — fixes both, and a real geocoder is only needed for
  addresses rather than areas.
- **The autocomplete needs JavaScript.** The rest of the search page works without it, but the area
  field is a client component, so with scripts off a visitor can still search by keyword, category
  and sort, just not filter by area from this form (a `locality=` already in the URL still applies).
- **Page size on `/search` is fixed** at the API default of 20; `pageSize` in the URL is ignored by
  the page on purpose, so visitors cannot ask for huge pages.
- **Admin password strength is judged by length only** (12 characters minimum), and nothing forces a
  password change. MFA itself is built and mandatory (D28–D31).
- **An owner is told by email when their listing is decided on** — and when an enquiry arrives, when
  staff ask for a correction, and when a subscription is activated. **No email provider is
  configured**, so outside Development every one of those is recorded as a `failed` notification
  rather than delivered. The status and the reviewer's reason are on the owner's listings screen
  either way.
- **A hand-added listing has no owner account attached.** `created_by_user_id` is null, so the
  business cannot manage it until someone links it to an owner — there is no screen for that yet.
- **Public pages refresh on approval only when `REVALIDATE_TOKEN` and `MAIN_SITE_URL` are set** on
  both apps. Without them the public site still catches up on its own within 60 seconds.
- **The rejection reason is free text.** There is no list of standard reasons, so wording is up to the
  reviewer.
- **Admin session lifetime** is 15 minutes for the access token and 7 days for the refresh token
  (`Auth:AdminAccessTokenMinutes`, `Auth:AdminRefreshTokenDays`). The lockout is 5 wrong passwords for
  15 minutes, counted per account, not per IP.

## Recently decided (2026-10-17)

- **D22 — public URL scheme.** ~~The locality-first `/{city}/{locality}/{category}/{slug}` scheme
  stays.~~ **Superseded on 2026-10-26**: public URLs are category-first
  (`/food/cafes/garden-cafe`), with areas under `/areas/{locality}`. `docs/decisions.md` still
  records the old scheme and needs a new row. The API's own addressing
  (`{city}/{locality}/{slug}`) did not change.
- **D23 — subscription tiers.** ~~Free ₹0 / Basic ₹699 / Advanced ₹6999 / Premium ₹36999~~
  **Superseded.** The owner confirmed on 2026-10-25 that the structure is **Free and Verified
  (₹399) only**, with no Gold or Premium. `S0009` deactivated the three old tiers and `S0011`
  deleted their rows; `plans` now holds exactly two.
- **D24 — onboarding shape.** Registration collects name, business name, email, locality and primary
  category, and creates the profile, business, ownership row and first draft listing in one
  transaction.

### Where the design references actually are (found 2026-10-17)

They are not in this repository, and the four screenshots the owner refers to were not on this
machine either. What *is* on the machine, and is a better reference than a screenshot, is the
owner's own reference implementation of the public site:

| Reference | Path | What it covers |
|---|---|---|
| **Reference Build V2** | `C:\Users\gadip\Downloads\HyderabadLinks_Reference_Build_V2\HyderabadLinks_Reference_Build` | The public site. `Views/Home/Index.cshtml`, `Views/Search/Index.cshtml`, `Views/Search/Details.cshtml`, `Views/Shared/_PublicLayout.cshtml` and **`wwwroot/css/public-home.css`**, which is the whole visual system in one file: the teal palette, the header, the hero, the category grid, the circular logo cards, the ribbons and the footer |
| **Owner prototype** | `C:\Users\gadip\Downloads\HyderabadLinksPrototype_fixed\HyderabadLinksPrototype` | The owner portal only — `Views/Auth/Login.cshtml`, `Verify`, `Onboarding`, `Dashboard`, `Listings`, `Plans`. This is the login and onboarding workflow reference. It has **no** public homepage or search views |

The redesign now follows Reference Build V2 rather than a guess. Its homepage markup was the source
for the section order, the copy, the kickers and the card shapes; `public-home.css` was the source
for the palette now in `globals.css`.

Two things in the reference were deliberately **not** copied, and both are noted under "Known
limitations": its hard-coded "Trending" and "Featured" business lists (this site uses real listings
instead), and its About / Membership / Contact / Terms / Privacy links and social icons (those
routes do not exist here, and the reference's own social links are `href="#"`).

The reference's own search and detail URLs (`/Business/SearchResults?searchTerm=food` and
`/food/restaurants/barbeque-and-grill/kphb/{business}`) are **not** adopted: **D22** already settled
that, and the redesign changes no URL.

## Decisions needed from the owner

1. **The payment provider** (D45). The adapter is written against Razorpay and nothing is
   configured. Confirming the provider, and then approving live mode explicitly (D50), is what turns
   the ₹399 plan from code into revenue.
2. **The email provider** (D14, D42). Resend is *assumed*, never approved. Nothing the platform
   sends reaches anybody until this is settled and a sending domain is verified in DNS.
3. **One API or two?** The brief asks for two; D1 records the single modular API as approved.
   Nothing is blocked while it is open — the API is already organised by audience, so the split
   would mostly move folders.
4. **Maps provider** (D14) — still open and still avoidable: `/public/localities/nearest` resolves
   coordinates against the 103 seeded areas with no provider and no key. A real geocoder is only
   needed for street addresses rather than areas.
5. **Edge protection and private networking** (D13) — before production launch.
6. **Locality coverage.** 103 areas is partial for Hyderabad and is the limiting factor on the
   location autocomplete: an area that is missing cannot be typed or resolved to. Extending the
   dataset is a reference-data job, not a code one.
7. **Preview deployments.** Making them work means letting an unreviewed branch talk to the
   production database, because there is no staging. See `REPAIR_STATUS.md`.

**Settled since this list was last written:** the plan structure and its allowances (D48, `S0016`),
the verified badge (a paid period grants it and nothing else does), the OTP provider (MSG91 —
integrated and diagnosable, delivery still unproven), the media store (D49) and live payment mode
(D50).

## Missing credentials and configuration

None of these are in the repository, and none should be.

| What | Configuration key | Status |
|---|---|---|
| OTP / SMS delivery | `MSG91:AuthKey`, `MSG91:TemplateId` | **Code is wired up and finished** (`Msg91SmsSender`). Not configured: Development prints the code to the API console (`ConsoleSmsSender`), and outside Development a missing key is announced as a startup warning rather than a refusal, because search and every listing page work without SMS. **No real code has ever been delivered**, and the template variable names are unproven — one real send is the only way to know. |
| JWT signing key | `Auth:JwtSigningKey` | Development generates one. Production must supply it. |
| OTP HMAC key | `Auth:OtpHmacKey` | As above. |
| TOTP encryption key | `Auth:TotpEncryptionKey` | **Required in production** (base64, ≥32 bytes; only the first 32 are used). Development generates a random one per start, which invalidates enrolled authenticators on every restart. Rotating it in production forces every admin to re-enroll. |
| Database | `ConnectionStrings:Default` | `dotnet user-secrets` locally, App Service settings in Azure. Never `appsettings.Development.json`, which is tracked. |
| Email delivery (D14, D42) | `Email:Provider`, `Email:ApiKey`, `Email:FromAddress`, `Email:ReplyTo`, `Email:SiteBaseUrl` | **Code is wired up; no provider is configured.** See the paragraph below for exactly what is outstanding. |
| Razorpay | `Payments:Provider`, `Payments:KeyId`, `Payments:KeySecret`, `Payments:WebhookSecret` | **Code is wired up** behind `IPaymentGateway` (D45). Not configured: every paying route answers 503 and writes nothing. A key id without its secret counts as unconfigured, and an `rzp_live_` key is refused unless `Payments:LiveModeApproved` is true (D50). No payment has ever been taken. |
| Media storage | `Media:Provider`; R2: `Media:R2AccountId`, `Media:R2AccessKeyId`, `Media:R2SecretAccessKey`, `Media:BucketName`, `Media:PublicBaseUrl`; Azure: `Media:BlobConnectionString`, `Media:ContainerName`, `Media:PublicBaseUrl` | **Code is wired up and used** for both (D49, D33). Nothing is configured, so uploads answer 503 rather than pretending. `Media:PublicBaseUrl` is **required** for R2, because a bucket serves nothing until a domain is bound to it in the dashboard. Secrets belong in user-secrets or Key Vault — `README.md` lists every key each provider needs. |
| Dummy OTP | `Auth:DummyOtpEnabled` | **An authentication bypass**, off by default. With it on, every owner login code is `123456` and no SMS is sent, which is the only way to test the owner journey while MSG91 delivery is unproven. It is announced on every start and logged on every code issued. Turn it off before anyone else can reach the site. |

### What email still needs, exactly

The abstraction, the templates, the recording and the two senders are built and tested
(`backend/BusinessDirectory.Api/Notifications/`). **Nothing is delivered to anybody outside
Development**, and these are the only things standing in the way:

1. **The owner's confirmation of the provider.** D14 records "Resend" as *assumed*, not approved. It
   has never been confirmed, so no adapter was written and `Email:Provider` has no production
   default. **Ask before assuming Resend.** Whatever is chosen, the work is one class implementing
   `IEmailSender` plus one line in `Program.cs`.
2. **A verified sending domain.** Every provider refuses to send `From:` a domain it has not
   verified, which means DNS records (SPF, DKIM, usually a CNAME or TXT pair) on
   `hyderabadlinks.com`. This is a DNS job, not a code one, and it is the part with a lead time.
3. **The provider's API key** → `Email:ApiKey`. A secret: Key Vault or an app setting, never a
   committed file. It is never logged — an integration test asserts the console sender does not
   print it, and the `notifications.error` column takes only an exception type and message.
4. **`Email:FromAddress`** — e.g. `no-reply@hyderabadlinks.com`, on the verified domain.
5. **`Email:ReplyTo`** — an inbox a person actually reads, if replies should not go to the From
   address. Optional.
6. **`Email:SiteBaseUrl`** — `https://hyderabadlinks.com`. Not a secret. Without it the emails still
   send, but carry **no links**, because a relative path is useless in a mail client. Set it.

Local development needs none of this: `appsettings.Development.json` sets `Email:Provider` to
`console`, and `ConsoleEmailSender` prints the message to the API console. There is deliberately no
`Email:ApiKey` in that file.

Once a provider is configured, the thing to re-verify is that `notifications` rows reach `sent`
against the real provider, and that a deliberately bad recipient reaches `failed` with a usable
reason. Until that has actually been run, **nothing should claim email delivery works.**

## The next step

**Last finished (2026-10-27):** the curated Featured shelf and staff correction requests (`S0017`,
D51–D52), with the permission catalogue now asserted by name rather than by count. Earlier the same
day: the two-video correction to the Verified plan (`S0016`), link previews, Cloudflare R2 media
storage (D49) and the live-payment-key refusal (D50). `npm run verify` passes — 534 unit and 185
integration tests, three production builds, no warnings.

Everything that remains is listed in "Not built yet", in the order that unblocks the most. Its first
four items are the owner's to unblock, and until the first one lands — **the first super-admin
account** — a large part of the product cannot be tested at all.

The most useful code-side work, in order:

1. **Switch on the `migrate` job** in `.github/workflows/main_hyderabad-links-api.yml`, which was
   written on 2026-10-27 and has never run. Nine migrations were applied by hand, and code shipping
   ahead of its schema is the likeliest cause of a production incident here. Switching it on is
   three settings (item 5 of "Not built yet"); proving it is one deployment with nothing pending,
   which `migrate --what-if` reports without changing anything.
2. **End-to-end tests** for the journeys that have only ever been walked by hand: owner sign-in →
   listing → review → publish, and the paid path as far as an unconfigured provider allows.
3. **A nonce-based CSP**, the last known weakness from the security pass.
4. **OpenAPI**, which the brief asks for and which `packages/api-client` is waiting on.

### The redesign (history — finished 2026-10-18)

The redesign was done one page at a time, each page verified in a browser before the next was
started, and all seven steps are complete: the design system and chrome, the location autocomplete,
the homepage (approved by the owner on 2026-10-18), search results, the login and onboarding
screens, the owner account and listing screens, and the listing detail page. The detail page was
built from the fields that existed, on the owner's instruction: the reference's rating, opening
hours, services, languages, contact person and social links were left out rather than faked, and
`factsFor()` is still the one place to add them.
