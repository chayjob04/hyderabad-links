# HYDERABAD LINKS

Location-first business directory for Hyderabad, Telangana. Public site: **https://hyderabadlinks.com**.

Three independent Next.js websites share **one ASP.NET Core API** and **one Microsoft SQL Server database** (Azure SQL Database in production).

| App | Folder | Local URL | Production domain |
|---|---|---|---|
| Main website | `apps/main-website` | http://localhost:3000 | hyderabadlinks.com |
| Admin website | `apps/admin-website` | http://localhost:3001 | *to be decided* (env-configured) |
| Super-admin website | `apps/super-admin-website` | http://localhost:3002 | *to be decided* (env-configured) |
| API | `backend/BusinessDirectory.Api` | http://localhost:5080 | *to be decided* |

**Status:** Running on **SQL Server** (Azure SQL Database in production) since 2026-10-21; the PostgreSQL migrations are kept as history and never run. Schema `S0001`-`S0008` and the Hyderabad reference seeds exist. The public site has the home page,
database-backed search (keyword, category, locality, proximity, sorting and paging), locality/category pages,
listing pages with photos, reviews, enquiries and abuse reporting, and an XML sitemap (English only). Owners sign
in by phone OTP and manage their listings, photos, enquiries and saved businesses. Administrators sign in with a
password plus a mandatory authenticator and moderate listings, reviews and reports. The super-admin site manages
staff accounts, roles and the audit log. Not built: notifications of any kind, subscriptions and payments.
See `docs/PROJECT_STATUS.md` for the current state and the next step, and `docs/` for architecture and decisions.

## Prerequisites (Windows; see docs/local-development.md for details)

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install Microsoft.DotNet.SDK.10
winget install Microsoft.VisualStudioCode
```

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
npm install                      # installs all three websites (npm workspaces)
npm run db:migrate                                     # apply migrations + reference seeds (safe to re-run)
npm run db:seed-dev                                    # optional: sample listings for local testing (Development only)
dotnet run --project backend/BusinessDirectory.Api     # API on :5080   (terminal 1)
npm run dev:main                                       # main site :3000 (terminal 2)
npm run dev:admin                                      # admin :3001     (terminal 3, optional)
npm run dev:super-admin                                # super-admin :3002 (terminal 4)
```

Each website reads its own settings from `apps/<app>/.env.local`; copy `apps/<app>/.env.example` to start one.
**Never commit `.env` files.** On Vercel the same values come from the project's environment variables.

Media uploads need somewhere to put the files. Nothing is configured by default, which makes the API
refuse uploads with an explanation rather than accepting files it cannot store. Two services are
supported, and `Media:Provider` chooses between them.

**Cloudflare R2** (what production uses). R2 speaks the S3 API, so the AWS S3 client talks to it once
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

To sign in to the admin site you need an admin account. There is no sign-up page; create one from the
command line (the password comes from an environment variable so it stays out of the shell history):

```powershell
$env:ADMIN_BOOTSTRAP_PASSWORD = "a long passphrase"
dotnet run --project backend/BusinessDirectory.Api -- create-admin --email you@example.com --name "Your Name" --role super_admin
```

Run it again with the same email to reset that account's password.

Quick checks once running:
- http://localhost:5080/health/live, http://localhost:5080/health/ready (checks the database) and http://localhost:5080/api/v1/public/meta
- http://localhost:3000/health, http://localhost:3001/health, http://localhost:3002/health

## Verify everything (build + tests)

```powershell
npm run verify
```

Runs: migration safety check, its self-tests, TypeScript checks, production builds of all three apps, the .NET build
and the .NET tests.

Database behaviour has its own checks — thirteen of them, in `database/sqlserver/checks/`. They insert, assert and
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
apps/        three Next.js websites (independent builds and deployments)
backend/     ASP.NET Core API + unit and integration test projects
packages/    shared TypeScript config; generated API client (later)
database/    migrations/ (versioned SQL), rollback/, seeds/, queries/
tests/e2e/   Playwright end-to-end tests (later)
infrastructure/azure/   infrastructure as code (later)
docs/        requirements, architecture, decisions, security, deployment
scripts/     repository tooling (migration safety check)
```
