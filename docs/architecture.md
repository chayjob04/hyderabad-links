# Architecture

Visitors              Admins               Super-admins
   │                    │                       │
main-website        admin-website        super-admin-website
                     (Next.js, one App Service each)
   └────────────────────┼───────────────────────┘
                        ▼  server-to-server (backend-for-frontend pattern)
              ASP.NET Core API /api/v1/... (modular monolith)
                        │
       Microsoft SQL Server / Azure SQL Database
       · Blob Storage · Key Vault · Application Insights
       External: MSG91 (OTP SMS), Razorpay, email provider, maps provider

## Principles

1. **Browsers talk only to their own Next.js server.** That server calls the API. Cookies stay on each app's own origin
   (httpOnly, Secure), CORS stays minimal, and an undecided admin domain can never break login.

2. **Modular monolith.** One API; modules by folder (`Modules/Auth`, `Listings`, `Media`, `Billing`, ...). Modules call each
   other through interfaces, never through each other's tables.

3. **Route prefixes separate audiences:** `/api/v1/public`, `/api/v1/me` (owners), `/api/v1/admin`, `/api/v1/super-admin`.

4. **Runtime configuration.** Domains, API URLs and environment names come from environment variables read at runtime, so one
   build can be promoted from staging to production. Avoid `NEXT_PUBLIC_*` for anything deployment-specific: those values are
   baked in at build time.

5. **Server-side authorization always.** Frontend route protection is a convenience, never the control.

## Local ports

Main 3000 · Admin 3001 · Super-admin 3002 · API 5080. The database and blob storage are Azure services; nothing runs locally for them.

## Database and migrations

- **Local database:** none. Development connects to an Azure SQL database, so the engine and feature set match production.
- **Production database:** Azure SQL Database.
- **Driver:** `Microsoft.Data.SqlClient`, using raw parameterized SQL; no ORM.
- **Current migrations:** `database/sqlserver/migrations/`, applied by DbUp.
- **Historical migrations:** `database/migrations/` contains the former PostgreSQL migrations. They are retained for historical reference and must not be executed against SQL Server.

## What exists in Phase 0

- Three placeholder Next.js apps: security headers, `/health`, `robots` (admin sites fully blocked from indexing and show an
  environment banner; super-admin banner is a different colour on purpose).
- API: `/health/live`, `/api/v1/public/meta`, security headers, deny-by-default CORS, per-IP rate limit, generic error responses,
  startup refusal of wildcard CORS outside Development.
- Migration safety checker and CI skeletons.
