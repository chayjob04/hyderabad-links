# Consolidating Admin and Super Admin into one Staff website

Status: **steps 1–7 done locally on 2026-11-10; step 8 (deployment) not started.**
`apps/admin-website` and `apps/super-admin-website` are gone; `apps/staff-website` replaces both.
The Vercel projects are untouched and still serve the old two-site build.

What was built differs from the plan below in one place worth recording: the login page keeps a
session for the tab that was used and only that one, even for an account holding both roles. The
plan left that open; signing in twice is a small cost against keeping a stolen cookie worth exactly
what it was worth when these were two sites.

Not verified: a real sign-in on either tab. There is no SQL Server on this machine, and the only
database reachable from here is production, so the flows that need rows were not run. See the
report for what was tested instead.

---

Written 2026-11-10 for approval.

## Why this is necessary, not just tidier

The two staff sites live on `hyderabad-links-nine.vercel.app` and
`hyderabad-links-super-admin.vercel.app`. Both have the apex `vercel.app`, which is on the
[Public Suffix List](https://publicsuffix.org/), so a cookie scoped to `.vercel.app` is rejected by
every browser. There is no way to share a session cookie between those two hosts.

That is the whole reason one common login page is impossible today, and the reason the fix is a
deployment change rather than a code change. Put both dashboards on **one origin** and the problem
disappears: one cookie jar, one login page, and nothing about cookie security has to be relaxed to
get there.

## Final architecture

Two deployed applications.

| | Project | Origin | Holds |
|---|---|---|---|
| 1 | `hyderabad-links-main` | hyderabadlinks.com | public site, user login, business login, user dashboard, owner dashboard |
| 2 | `hyderabad-links-staff` | one staff origin | one login page, admin dashboard, super-admin dashboard |

Inside the staff application:

```
/login                 one page, two tabs: Admin login | Super admin login
/admin/*               the admin dashboard   (today's admin-website)
/super-admin/*         the super-admin dashboard (today's super-admin-website)
```

### What stays separate

Consolidating the *deployment* does not merge the surfaces. All of this is unchanged:

- **Two cookie sets**, both httpOnly and host-only: `hl_admin_access` / `hl_admin_refresh` and
  `hl_super_access` / `hl_super_refresh`. Nothing becomes domain-scoped.
- **Two token audiences** in the API: `admin` and `super-admin`. An admin token still cannot reach
  `/api/v1/super-admin`, enforced by the scheme, not by the UI.
- **Two permission lists**, `AdminPermissions.AdminSurface` and `SuperAdminOnly`, still disjoint.
- **MFA**, recovery codes, lockout, the audit log: untouched.
- **Two dashboards**, two sidebars, two API clients. Separate code, separate guards.

## How the tab is verified against the real role

The tab is a *request*, never a grant. The backend already decides this and needs **no change**:

1. `POST /api/v1/auth/admin/login` — email and password. Returns only an MFA token.
2. The authenticator code is verified. The API returns `SessionDto`, which carries
   `accessToken` (admin audience) and `superAdminAccessToken` — and the second one is
   **present only for an account holding `admins.manage`**, minted by `HoldsSuperAdmin`, read live
   from the database on every sign-in and every refresh.

So the login action does this:

| Tab chosen | Condition | Result |
|---|---|---|
| Admin | always | set `hl_admin_*`, redirect to `/admin` |
| Super admin | `superAdminAccessToken` present | set `hl_super_*`, redirect to `/super-admin` |
| Super admin | token absent | refuse: "That account does not have platform administration access." |

Choosing the super-admin tab with an ordinary admin account gets you nothing, because the API never
issued a super-admin token to hand over. The frontend selection decides *which cookie we keep*, and
the database decides *whether there was anything to keep*.

A sign-in sets only the cookies for the tab that was used. Holding both roles does not sign you into
both surfaces at once; you sign in again on the other tab. That keeps the blast radius of a stolen
cookie exactly where it is today.

**No API change. No database migration.** Nothing in `backend/` or `database/` is touched by this
work.

## The mechanical work: route collisions

Eight paths exist in both apps and must be namespaced. This is the bulk of the effort and the main
source of risk, because every internal link has to move with them.

| Collides | Admin becomes | Super admin becomes |
|---|---|---|
| `/` | `/admin` | `/super-admin` |
| `/layout.tsx` | `/admin/layout.tsx` | `/super-admin/layout.tsx` |
| `/login`, `/login/reset` | — | — (one shared `/login` at the root) |
| `/access-denied` | `/admin/access-denied` | `/super-admin/access-denied` |
| `/health` | — | — (one shared `/health`) |
| `/listings`, `/listings/[id]` | `/admin/listings` | `/super-admin/listings` |

Everything else moves under its prefix unchanged: admin keeps `blog`, `categories`, `locations`,
`reports`, `reviews`, `search`, `seo`, `homepage`; super admin keeps `accounts`, `admins`, `audit`,
`featured`, `overview`, and its `listings/by-category`, `by-subcategory`, `[id]/content`,
`[id]/faqs`, `[id]/links`, `new`.

### Files that merge, and files that must not

Identical or near-identical in both apps — merge into one copy, parameterised by surface:
`lib/session-cookies.ts`, `lib/session.ts`, `lib/revalidate.ts`, `lib/brand.ts`,
`components/AccessDenied.tsx`, `components/StaffSidebar.tsx`, `globals.css`, `next.config.ts`
(byte-identical), `postcss.config.mjs`. Dependencies are already **byte-identical**, so there is no
version reconciliation to do.

Kept separate on purpose: `lib/admin-api.ts` and `lib/super-admin-api.ts`. They target different
audiences, and merging them is the one change in this plan that could let a bug cross between
surfaces. Also separate: `AdminChrome.tsx` / `SuperAdminChrome.tsx`, `Pagination.tsx`,
`StatusBadge.tsx`, `ListingForm.tsx`, `ListingStaffNav.tsx`.

### Middleware: two become one

Next.js allows exactly one middleware per application. Today each app has its own `src/proxy.ts`
with **different refresh semantics**: the admin one keeps the returned `accessToken`; the
super-admin one requires `superAdminAccessToken` and signs you out if it is missing, so an account
that loses `admins.manage` cannot keep a dead session alive.

The merged middleware branches on the path prefix and keeps both behaviours exactly. This is the
single most delicate file in the migration — if the admin branch ran on `/super-admin/*`, an account
that lost its platform access would keep working until the refresh token expired.

**A pre-existing gap worth fixing while we are here.** The current matchers do not cover every
signed-in route:

- admin matches `/listings`, `/reviews`, `/reports` — missing `blog`, `categories`, `locations`,
  `search`, `seo`, `homepage`
- super admin matches `/overview`, `/admins`, `/audit` — missing `accounts`, `featured`, `listings`

On the unmatched pages the 15-minute access token simply dies and you are bounced to the login page
instead of being refreshed silently. Harmless but irritating, and the merge is the natural moment to
widen both matchers to the whole prefix.

## Environment variables

The merged staff app needs four, all of which already exist:

```
API_BASE_URL      the ASP.NET Core API (unchanged)
APP_ENV           drives the environment banner (unchanged)
MAIN_SITE_URL     for revalidating public pages after an approval (today: admin only)
REVALIDATE_TOKEN  the shared secret for that (today: admin only)
```

`SUPER_ADMIN_SITE_URL` and `ADMIN_SITE_URL` — added for the cross-site tab links — are deleted. The
tabs become in-page.

The super-admin app does **not** currently have `MAIN_SITE_URL` or `REVALIDATE_TOKEN`. They must be
present on the merged project or page revalidation after an admin approval stops working.

## Vercel and domains

Recommended: **rename and reuse `hyderabad-links-admin`** rather than creating a new project. It
keeps its domain, its environment variables and its deployment history, and there is one fewer thing
to get wrong.

1. Rename `hyderabad-links-admin` → `hyderabad-links-staff`.
2. Point it at the merged app directory.
3. Add `MAIN_SITE_URL` and `REVALIDATE_TOKEN` if the rename does not carry them.
4. Deploy, verify both dashboards, **then** retire `hyderabad-links-super-admin` — leaving it in
   place as a redirect to the new `/super-admin` for a while, so bookmarks do not simply break.

A custom staff domain (`staff.hyderabadlinks.com`) is worth doing but is **not required** by this
plan and can follow later. Note that it must be a single subdomain for the staff app — not a parent
domain cookie shared with the public site, which would be a genuine weakening.

## Risks

1. **Everyone is signed out at cutover.** Cookies are host-only on the two old origins; the new
   origin has none. Expected, harmless, but say so before it happens.
2. **Old super-admin bookmarks break.** Mitigated by the redirect in step 4 above.
3. **Route moves are where regressions hide.** The UI parity work is recent and extensive. The moves
   must be *pure* — file moves plus import and href rewrites, no behaviour edits in the same commit —
   so that anything that breaks is obviously a path, not a feature.
4. **The merged middleware** is the one file where a mistake has a security consequence. It deserves
   its own test and its own review pass.
5. **Two sessions in one cookie jar.** An admin-only account must not reach `/super-admin/*`. It
   already cannot — the API refuses without a super-admin token — but the route guard should refuse
   before rendering too, as it does today.
6. **CORS is probably unaffected**, because the browser never calls the API directly (the Next.js
   server does, server-to-server). Worth confirming against the API's `Cors:AllowedOrigins` before
   cutover rather than assuming.
7. **`npm run verify` builds three sites today.** The script, the workspace list and CI all need the
   new app name.

## Sequence

Each step ends at a gate where nothing is deployed and the previous state still works.

1. Create `apps/staff-website` from `admin-website` (it is the larger of the two). Verify it builds.
2. Move admin routes under `/admin`. Rewrite links. `npm run verify` green.
3. Copy super-admin routes under `/super-admin`. Rewrite links. Merge the API clients in as a second
   client, not a shared one. `npm run verify` green.
4. Merge the two middlewares into one, with a test for the prefix branching.
5. Build the one `/login` page with the two tabs and the role check above.
6. Test all four flows locally against a **local** database: admin sign-in, super-admin sign-in,
   ordinary admin choosing the super-admin tab (must be refused), and session refresh on both
   prefixes.
7. Delete `apps/admin-website` and `apps/super-admin-website` only after step 6 passes.
8. Deploy to the renamed Vercel project — **with your approval** — verify, then retire the old
   super-admin project as a redirect.

Steps 1–7 change nothing that is deployed. Step 8 is the only one that touches production.
