# Customers and business owners are separate accounts

Status: **built locally on 2026-11-10. S0026 is written but not applied to any database, and nothing
is deployed.** See "Before this goes out" at the end.

## What changed, in one paragraph

Verifying a login code used to upsert a row in `users`, whichever tab you came from. So somebody who
signed in to save a shop became a business account, and "has this person registered a business?" was
answered by `name IS NULL`. Customers now have their own table, their own OTP purpose, their own
session table, their own token audience and their own cookies. The same mobile number may hold a
customer account and a business account at the same time, independently, and neither can reach the
other's routes.

## The two realms

| | Customer | Business owner |
|---|---|---|
| Identity table | `customers` | `users` |
| Sessions | `customer_sessions` | `user_sessions` |
| OTP purpose | `customer_login` | `owner_login` |
| Token audience | `customer` | `owner` |
| Auth scheme | `CustomerBearer` | the default bearer |
| Policy | `Customer` | `Owner` |
| Cookies | `hl_cust_access` / `hl_cust_refresh` | `hl_access` / `hl_refresh` |
| API routes | `/api/v1/auth/customer`, `/api/v1/customer` | `/api/v1/auth/owner`, `/api/v1/me` |
| Website routes | `/my/*` | `/account/*` |
| Login tab | `/login?tab=user` | `/login?tab=business` |
| Owns | favourites, reviews, own name and email | businesses, listings, enquiries, plans |

Staff authentication is untouched. `admin`, `super-admin`, `admin-mfa` and `admin-enroll` are exactly
as they were, and no file under `apps/staff-website` changed.

## What actually keeps them apart

Both tokens are signed with the same key and carry nothing but a subject id. **The audience is the
only difference**, so the separation rests on two things and it is worth knowing which:

1. **The scheme validates the audience** (`CustomerAccess.Scheme`, registered in `Program.cs`), and
   **the policy pins the scheme** (`AddAuthenticationSchemes`). Register the customer handler as a
   second *default* bearer, or forget the pinning, and either token would work on both sides. This
   is the mistake the type system cannot see, which is why `CustomerAccessTests` exists.
2. **The foreign keys are the backstop.** A `customers` id written where a `users` id belongs is
   refused by the database, because the two columns point at different tables.

`CustomerAccess` is deliberately thin. A customer has no roles and no permissions, so there is
nothing to load — unlike `AdminAccess`, which reads them live on every request.

## Shared on purpose

Three things are shared, and each for a reason:

- **`otp_challenges`**, one table with two `purpose` values. The per-phone and per-IP rate limits are
  counted from these rows, so a second table would hand an attacker a second allowance against the
  same number. Redeeming matches on `purpose`, so a code minted for one sign-in cannot open the
  other. Somebody who genuinely signs in to both spends two of their five an hour.
- **`OtpFlow`**, the sending and redeeming mechanics. Two copies of a rate limit eventually disagree,
  and the weaker copy is the one that gets used.
- **`SessionStore`**, the rotate-and-detect-reuse rules, over two tables chosen from two private
  constructor calls. The table names are interpolated into the SQL; nothing from a request reaches
  them, and every value is still a parameter.

MSG91 is untouched. The code is generated, hashed, stored and handed to `ISmsSender` exactly as
before, whichever flow asked for it.

## The migration

`S0026__customer_identity.sql` is additive and safe to run **while the old API is still serving**.

1. Creates `customers` and `customer_sessions`.
2. Widens `otp_challenges.purpose` and `audit_logs.actor_type`.
3. Adds `favourites.customer_id`, `reviews.customer_id`, `reports.reported_by_customer_id`.
4. **Backfills**: one customer row per user that holds a favourite or a review, copying phone, name,
   email, verification moment and status; then repoints those rows. An owner who never saved or
   reviewed anything gets no customer row.
5. Aborts with `THROW 51035` if any favourite or review is left without a `customer_id`. A
   half-applied identity split is worse than a failed one.
6. Replaces `favourites_pkey` and `reviews_one_per_person` with **filtered unique indexes**, and
   makes `user_id` nullable with a CHECK that one of the two columns is set.

Step 6 is the one worth understanding. A primary key cannot hold NULL, and SQL Server's UNIQUE treats
two NULLs as equal, so the original constraints break the moment the new API writes a row with
`user_id` NULL. Filtered indexes ignore the NULL side, which is what lets both versions of the API
write to these tables at once.

Nothing is deleted. `user_id` is still populated on every pre-existing row, and that is the rollback
material.

### Deployment order

```
S0026  ->  API  ->  frontend  ->  verify  ->  S0027 (by hand)
```

`database/sqlserver/manual/` holds the two scripts that DbUp must never run:

- **`S0026_down.sql`** — restores the original constraints from `user_id` and drops the new tables.
  It refuses if the new API has already written rows that have no `user_id` to rebuild from.
- **`S0027__customer_identity_finalise.sql`** — makes `customer_id` NOT NULL, drops `user_id`, and
  restores a plain primary key. **Running it ends the rollback window.**

## What an existing account sees

- **Every listing, business membership, subscription and enquiry is untouched.** No owner is signed
  out: the owner cookie names did not change.
- **An owner who had saved favourites finds them under the user tab**, because those rows moved to
  their customer twin. They sign in once on the user tab to see them. This is inherent to the split
  and is the one behaviour change an existing user will notice.
- `/account/favourites` and `/account/chat` permanently redirect to `/my/saved` and `/my/chat`.

## Things worth knowing

- **Reviewing your own business is still refused**, but the check is now on the *verified phone
  number* rather than on an id: a customer id means nothing to `business_members`, and the number is
  what the two identities share.
- **Review reads use `LEFT JOIN` on both identities** and `COALESCE` the author. An inner join on
  either would silently drop half the reviews while both columns exist.
- **The header shows the customer account when somebody holds both**, since it sits on the public
  pages; their business dashboard is one click away inside the menu.
- **A customer `next` path may be any path on this site**, unlike an owner's, which must be inside
  `/account`. A customer signs in from a business page to save it, and sending them back there is the
  point. Both refuse `//` and backslashes, so neither can be talked into another host.

## Before this goes out

1. **S0026 has not been applied to anything.** There is no SQL Server on this machine and production
   is out of scope, so the migration, the backfill and
   `database/sqlserver/checks/customer_identity_smoke.sql` are **unverified**.
2. **No sign-in has been run.** Both flows build and typecheck; neither has been exercised against a
   database.
3. Take `npm run db:export` before applying S0026.
4. Keep S0027 for after the deployment is verified. It is the point of no return.
