# Requirements summary

Source of truth for scope. Full original brief is held by the project owner; this is the condensed version.

## Product
- HYDERABAD LINKS: location-first business directory, Hyderabad first, designed to expand to other cities.
- Public domain: hyderabadlinks.com. Admin and super-admin domains **not decided**: must stay configurable.

## Hard constraints
- Next.js (App Router) + React + TypeScript + Tailwind; ASP.NET Core Web API (C#); Microsoft SQL Server / Azure SQL + Microsoft.Data.SqlClient + raw parameterized SQL; **no ORM**.
- Azure: App Service, Azure SQL Database, Blob Storage, Key Vault, Application Insights. GitHub + GitHub Actions.
- Modular monolith. No Kubernetes / microservices without demonstrated need.
- Three separate Next.js apps (main, admin, super-admin), independently deployable, one API, one database.
- Browsers never connect to the database; all changes go through authorised API endpoints; permissions enforced on the server.
- OpenAPI is the API contract; TypeScript client is generated.
- Migrations: version-controlled SQL; no destructive migration without approval.
- No paid Azure resource without a cost explanation and approval.

## Plans (stored in the database, editable by authorised staff)

**Settled on 2026-10-25 (decision D48): two plans, and no others.** The Basic / Gold / Premium
table that stood here is gone — `S0009` deactivated those tiers and `S0011` deleted their rows, so
`plans` holds exactly these two. The owner reconfirmed it on 2026-10-27 and corrected the video
allowance from three to two (`S0016`); a brief that reintroduced the old tiers was withdrawn the
same day.

| Plan | Price | Photos | Videos | Logo | Links | Verified badge |
|---|---|---|---|---|---|---|
| Free | ₹0 | 0 | 0 | 0 | 0 | no |
| Verified | **₹399 a year, per listing** | 10 | 2 | 1 | 5 | **yes** |

- Limits enforced on the backend, never only in the UI, and read from the `plans` table rather than
  from constants — so a price or an allowance is an `UPDATE`, not a deploy.
- Entitlement is computed from the subscription period against the clock
  (`listing_entitlements`), never from a flag on the listing, so a lapsed plan loses its allowance
  on the next request with no job to run.
- **Verification is what the paid tier buys** (D48, superseding the earlier rule that a paid plan
  must never grant it automatically). It is granted only by a payment whose signature verified, and
  it lasts exactly as long as the period paid for.
- Downgrades never silently delete media.
- Paid features activate only after the backend confirms payment (signed, idempotent Razorpay webhooks).

## Public URL structure
`/`, `/{city}`, `/{city}/{locality}`, `/{city}/{locality}/{category}`, `/{city}/{locality}/{category}/{business-slug}`
(lowercase, hyphenated; immutable database IDs internally; canonical URLs and 301 redirects for changes).
