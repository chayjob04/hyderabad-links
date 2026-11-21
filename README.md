# HYDERABAD LINKS

Location-first business directory for Hyderabad, Telangana. Intended public site:
**https://hyderabadlinks.com** — that domain does **not** serve this application yet; it still answers
from an unrelated one, so today the sites are reachable only at their Vercel URLs.

**Two** independent Next.js websites share **one ASP.NET Core API** and **one Microsoft SQL Server
database** (Azure SQL Database in production). Until 2026-11-10 there were three: the separate
super-admin website was merged into the staff website, because one sign-in page with two tabs is
impossible across two `*.vercel.app` hosts — that is a public suffix, so no cookie can be shared
between them.

| App | Folder | Local URL | Surfaces | Deployed as |
|---|---|---|---|---|
| Main website | `apps/main-website` | http://localhost:3000 | public directory, `/my` (customers), `/account` (business owners) | `hyderabad-links-main` on Vercel |
| Staff website | `apps/staff-website` | http://localhost:3001 | `/login` with two tabs, `/admin` (moderation), `/super-admin` (platform admin) | `hyderabad-links-staff` on Vercel |
| API | `backend/BusinessDirectory.Api` | http://localhost:5080 | `/api/v1/public`, `/customer`, `/me`, `/admin`, `/super-admin` | Azure App Service |

**Four separate identities.** Customer, business owner, admin and super admin are separate tables,
sessions, token audiences and cookies. The same mobile number may hold a customer *and* an owner
account, independently, and signing in to one never opens the other.

## Status

Running on **SQL Server** (Azure SQL Database in production) since 2026-10-21. The PostgreSQL
migrations under `database/migrations` are history and are never run. The live schema is
`S0001`–`S0028` in `database/sqlserver/migrations` plus the Hyderabad reference seeds; `S0027` is a
finalising script in `database/sqlserver/manual/` that DbUp deliberately never runs.

**Built and working:**

- Public directory with category-first URLs, database-backed search (keyword with typo tolerance,
  category, proximity, sorting and paging), area and category pages, listing pages with photos,
  opening hours, FAQs, reviews, enquiries and abuse reporting, a blog, and an XML sitemap (English
  only).
- Customers sign in by phone OTP at `/my` and save businesses, write reviews and manage a profile.
- Business owners sign in by phone OTP at `/account`, onboard, and manage listings, photos, hours,
  FAQs, links, enquiries and their subscription. Saving sends a listing to review, and so does every
  later edit.
- Staff sign in with a password plus a mandatory authenticator. Admins moderate listings, reviews
  and reports, send correction requests, and manage the taxonomy, blog, SEO and homepage curation.
  Super admins write listings, curate Featured, manage business accounts, manage administrator
  accounts, and read the audit log.
- Subscriptions: two plans only, Free and **Verified at ₹399 a year**, with the entitlement computed
  from the paid period at read time so a lapsed plan hides media rather than deleting it.

**Built but not configured, and inert on purpose.** Each of these refuses to pretend rather than
failing quietly, so none of them has ever done its job outside Development:

| Integration | Code | Without configuration |
|---|---|---|
| Payments (Razorpay) | adapter written, signature verification and webhook included | every paying route answers **503** and writes nothing; a live key is refused unless live mode is explicitly approved |
| Email notifications | `IEmailSender` with a Resend adapter, templates and a delivery record | sending throws and the notification is stored as **`failed`**, never reported as sent. No provider has ever been configured or tested |
| OTP SMS (MSG91) | finished and diagnosable | Development prints the code to the API console. **No real code has ever been delivered** |
| Media uploads (Cloudflare R2 or Azure Blob) | both providers written | every upload answers **503** rather than accepting a file it cannot store |

No payment has ever been taken, no file has ever been stored in a real bucket, and no email or SMS
has been delivered outside Development.

See `docs/PROJECT_STATUS.md` for the current state and the next step, and `docs/` for architecture
and decisions.

## Prerequisites (Windows; see docs/local-development.md for details)

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS --version 24.20.0
winget install Microsoft.DotNet.SDK.10
winget install Microsoft.VisualStudioCode
```

**Node is pinned to `24.x`** by `engines` in the root `package.json`, matching the CI workflows and
the Vercel projects — hence the explicit version above, because `OpenJS.NodeJS.LTS` on its own
installs whatever is LTS on the day and that is now a newer major. **The .NET SDK is pinned the same
way:** `global.json` asks for **10.0.404** with `rollForward: latestPatch`, so a 10.0.x patch is
fine and nothing else is.

No Docker, and no local database engine: the API talks to Azure SQL Database, the same engine in
development as in production.

## Configure the database

Start from the example, which is the only one of the two files in git:

```powershell
copy backend\BusinessDirectory.Api\appsettings.Development.json.example backend\BusinessDirectory.Api\appsettings.Development.json
```

`appsettings.Development.json` itself is git-ignored. Even so, secrets do not go in it: an ignored
file is one `git add -f` away from being committed. They go in user-secrets, which live outside the
working tree entirely:

```powershell
dotnet user-secrets set "ConnectionStrings:Default" "<your Azure SQL connection string>" --project backend/BusinessDirectory.Api
```

In Azure the same value comes from the App Service application settings, and nothing reads a file.

Point it at a development or test database, never at production. `npm run db:migrate` changes
whatever it is pointed at.

## Run locally

```powershell
npm install                      # installs both websites and the shared packages (npm workspaces)
npm run db:migrate                                     # apply migrations + reference seeds (safe to re-run)
npm run db:migrate -- --what-if                        # list what would be applied, and change nothing
npm run db:seed-dev                                    # optional: sample listings for local testing (Development only)
dotnet run --project backend/BusinessDirectory.Api     # API on :5080   (terminal 1)
npm run dev:main                                       # main site :3000 (terminal 2)
npm run dev:staff                                      # staff :3001     (terminal 3, optional)
```

Each website reads its own settings from `apps/<app>/.env.local`. Only the main website ships an
example to copy (`apps/main-website/.env.example`); the staff website has none yet, so take its keys
from `docs/local-development.md`. **Never commit `.env` files.** On Vercel the same values come from
the project's environment variables.

Media uploads need somewhere to put the files. Nothing is configured by default, which makes the API
refuse uploads with an explanation rather than accepting files it cannot store. Two services are
supported, and `Media:Provider` chooses between them.

**Cloudflare R2** (the chosen provider, decision D49 — chosen, but not configured anywhere yet, in
production or otherwise). R2 speaks the S3 API, so the AWS S3 client talks to it once
it is pointed at the account's endpoint. The bucket and its public domain are created in the
Cloudflare dashboard — see `docs/deployment.md` for that, and for why the API does not create them:

```powershell
dotnet user-secrets set "Media:Provider" "r2" --project backend/BusinessDirectory.Api
dotnet user-secrets set "Media:R2AccountId" "<cloudflare account id>" --project backend/BusinessDirectory.Api
dotnet user-secrets set "Media:R2AccessKeyId" "<r2 access key id>" --project backend/BusinessDirectory.Api
dotnet user-secrets set "Media:R2SecretAccessKey" "<r2 secret access key>" --project backend/BusinessDirectory.Api
dotnet user-secrets set "Media:BucketName" "listing-media" --project backend/BusinessDirectory.Api
dotnet user-secrets set "Media:PublicBaseUrl" "https://<your public r2 domain>" --project backend/BusinessDirectory.Api
```

`Media:PublicBaseUrl` is **required** for R2 and optional for Azure. An R2 bucket serves nothing
publicly from its S3 endpoint, so without it every upload would record a URL that resolves to
nothing. The API says exactly which setting is missing in its startup log.

**Azure Blob Storage** still works unchanged, for a deployment already using it:

```powershell
dotnet user-secrets set "Media:BlobConnectionString" "<dev storage connection string>" --project backend/BusinessDirectory.Api
```

To sign in to the staff website you need a staff account. There is no sign-up page, and the command
line is the only way to create the **first** one (the password comes from an environment variable so
it stays out of the shell history):

```powershell
$env:ADMIN_BOOTSTRAP_PASSWORD = "a long passphrase"
dotnet run --project backend/BusinessDirectory.Api -- create-admin --email you@example.com --name "Your Name" --role super_admin
```

Run it again with the same email to reset that account's password. Once one super admin exists,
further administrator accounts are created, edited, disabled and reset in the panel at
`/super-admin/admins`: the super admin sets a temporary password, reads it once off the screen and
hands it over, and the account can reach nothing until it changes that password. No email is sent,
because no email provider is configured.

Quick checks once running:
- http://localhost:5080/health/live, http://localhost:5080/health/ready (checks the database) and http://localhost:5080/api/v1/public/meta
- http://localhost:3000/health and http://localhost:3001/health

## Verify everything (build + tests)

```powershell
npm run verify
```

Runs: migration safety check, its self-tests, TypeScript checks, production builds of both websites, the .NET build
and the .NET tests.

Database behaviour has its own checks — twenty-four of them, in `database/sqlserver/checks/`. They insert, assert and
roll back, so they leave no data and are safe to re-run. They need a database and the schema, so they are not part
of `npm run verify` and not part of CI:

```powershell
npm run db:check
```

One of them, by any part of its name:

```powershell
npm run db:check -- review
```

They run against whatever `ConnectionStrings:Default` points at, and they print the server and database
they are about to use. Read that line before answering yes to anything.

The database itself has to exist before the first `npm run db:migrate`. Azure SQL creates databases with
its own options — collation, service tier, backup policy — so the migration runner deliberately never
creates one. Create it in the Azure portal, with the Azure CLI, or with one statement from any SQL
client connected to the server:

```sql
IF DB_ID('hyderabad_links') IS NULL CREATE DATABASE hyderabad_links;
```

## Repository layout

```
apps/main-website       public directory, /my (customers), /account (business owners)
apps/staff-website      /login with two tabs, /admin (moderation), /super-admin (platform admin)
backend/                ASP.NET Core API + unit and integration test projects
packages/config         shared TypeScript config
packages/api-client     placeholder, waiting on OpenAPI
database/sqlserver/     the live path: migrations/ (forward-only T-SQL), seeds/, checks/,
                        manual/ (never run by DbUp), repair/
database/migrations     the original PostgreSQL migrations, kept as history; never run
database/seeds, database/checks, database/queries, database/rollback   likewise history
tests/e2e/              a README only; Playwright is not set up
infrastructure/azure/   a README only; no infrastructure as code yet
docs/                   requirements, architecture, decisions, security, deployment
scripts/                repository tooling (migration and seed checks, with their own tests)
```
