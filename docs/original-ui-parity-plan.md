# Bringing the original site's UI across: the plan

**Status: built, 2026-11-02.** Everything below is done except where this section says otherwise.
The tables are left as written so the mapping from each original view stays readable; read them as
the record of what was decided, not as a to-do list.

**What was built differently from the plan:**

- `/verified/[category]` is not a route. The by-category variant is `?category=` on `/verified`,
  because it is the same page with a filter and two routes would be two places to fix a bug.
- `/listings/by-category` and `/listings/by-subcategory` on super admin read **one** endpoint
  (`/category-counts`) and group it in the page, rather than one endpoint per level. The two screens
  therefore cannot disagree about a number.
- `Super/RegisterData` is two pages, not three. `View` and `Edit` are one screen, because there is
  exactly one thing staff may change about somebody's account — whether it is suspended. The name,
  email and phone belong to the account holder.
- The owner's preview is a **checklist**, not a rendering of the public page. A draft has no public
  page, and the question before submitting is "what have I left out", which a faithful rendering
  answers badly: everything missing simply is not there to see.

**What was not built, and why:**

- **DECISION 1 (the third taxonomy level) was not taken,** so `Segment/ViewSegment`,
  `ViewSegment/Index`, `Super/ConfigSegment` and the two `BySegment` views are not built. Nothing
  here needed a change to the `categories` CHECK constraint.
- **DECISION 2 was taken as recommended:** areas, categories and search tuning stay on the admin
  surface. The three `Super/Config*` duplicates are not built. Two copies of a config screen is how
  one of them ends up un-gated.
- **DECISIONS 3 and 4 needed `S0025`**, which is written and additive but **has not been applied**.
  Until `npm run db:migrate` runs, the two admin screens have nothing to read and `v0003_smoke`
  fails, because it now expects the `homepage.manage` permission.
- **Nothing was verified in a browser.** No browser tooling was available in the session that built
  this. Every page compiles and typechecks; none has been seen to render.

The original is `WebZyte.HL.WebApp` (ASP.NET MVC, 115 `.cshtml` views, Bootstrap 5 + jQuery
on the public side, a bought Bootstrap admin template on the staff side). It is the reference for
**what pages exist and what they do** — not for how they are built. Every page below is rebuilt on
our own stack: Next.js App Router, our API, our database, our four token audiences.

Three rules hold throughout:

- Nothing already working is replaced. Reviews, enquiries, favourites, moderation, payments, MFA,
  permissions, the audit log, notifications, media allowances and SEO have no original equivalent
  and stay exactly as they are.
- No category, listing or row is deleted.
- Nothing in this plan changes the database architecture, API contracts, hosting, deployment
  configuration, environment variables or authentication **except the four items flagged
  DECISION**, which are listed separately at the end and need a yes before anything is written.

---

## 1. Public website → `apps/main-website`

| Original view | Our route | State | Work |
|---|---|---|---|
| `Home/Index` | `/` | exists | Redesign — see §5 |
| `Home/About`, `About/Index` | `/about` | exists | Content pass |
| `Home/Privacy`, `Privacypolicy/Index` | `/privacy` | exists | Real text (still placeholder) |
| `Termsofuse/Index` | `/terms` | exists | Real text (still placeholder) |
| `Membership/Index` | `/pricing` | exists | Redesign to match original's plan cards |
| `Business/SearchResults` | `/search` | exists | Redesign |
| `Business/Index`, `ViewListing/Index` | `/[category]/[subcategory]/[slug]` | exists | Redesign |
| `Category/ViewCategory` | `/[category]` | exists | Redesign |
| `SubCategory/ViewSubCategory`, `SubCategory/Index` | `/[category]/[subcategory]` | exists | Redesign |
| `Area/Index` | `/areas` | **missing** | New: index of every locality |
| `CategoriesList/Index` | `/categories` | **missing** | New: index of every category |
| `TrendingListing/Index` | — | **missing** | New: standalone trending page (shelf exists on `/`) |
| `VerifiedListingGroup/Index` | — | **missing** | New: verified businesses, grouped |
| `VerifiedListingCategory/Index` | — | **missing** | New: verified, within one category |
| `HomePageListingGroup/Index`, `hplg/Index` | — | **missing page** | Backend exists (`homepage_groups`, S0022); needs the public page |
| `Segment/ViewSegment`, `ViewSegment/Index` | — | **blocked** | Needs a third taxonomy level — **DECISION 1** |
| `Blog/Index`, `BlogHome/Home`, `BlogHome/Index` | `/blog` | exists | Redesign |
| `Blog/Details`, `BlogView/Index` | `/blog/[slug]` | exists | Redesign |
| `seo_home/Index` | `/` metadata | exists | Already served by `page_meta` (S0021) |
| `Business/Claim` | — | — | **Skip.** Dead view in the original: no controller action exists for it |
| `Shared/Error`, `Shared/NotFound` | `error.tsx`, `not-found.tsx` | exists | Style to match |

**New pages: 6.** `/areas`, `/categories`, `/trending`, `/verified`, `/verified/[category]`,
`/groups/[slug]`.

---

## 2. Owner dashboard → `apps/main-website/src/app/account`

Stays inside the main website, as asked. Nothing here requires a separate deployment.

| Original view | Our route | State | Work |
|---|---|---|---|
| `AddListing/Index`, `AddListing/Index1`, `BOAddLListing/Index`, `AddListings/Index` | `/account/listings/new` | exists | Redesign (four originals, one page here) |
| `AddListing/Success` | — | **missing** | New: a confirmation step instead of a bare redirect |
| `MyListings/Index`, `BOMylisting/Index`, `BOAccount/Mylisting` | `/account/listings` | exists | Keep the plan banner cards; redesign |
| `BO/EditListing/Index`, `EditListing/Index`, `AddListings/Edit` | `/account/listings/[id]/edit` | exists | Redesign |
| `BO/EditListingContent/Index`, `EditListingContent/Index` | `/account/listings/[id]/about` | exists | — |
| `BO/EditListingFaqs/Index`, `EditListingFaqs/Index` | `/account/listings/[id]/about` | exists | — |
| `BO/EditSocialLinks/Index`, `EditSocialLinks/Index` | `/account/listings/[id]/links` | exists | — |
| `BO/OpeningHours/Edit`, `OpeningHours/Edit` | `/account/listings/[id]/hours` | exists | — |
| `BO/ViewListing/Index` | — | **missing** | New: owner's preview of the public page before it is live |
| `BOAccount/Default`, `BOAccount/Edit`, `BOAccount/View`, `BusinessOwner/Index`, `BO/BusinessOwner/Edit` | `/account`, `/account/profile` | exists | Redesign |
| `Account/Default` | `/login` | exists | — |
| `Account/AccessDenied` | — | **missing** | New: a plain refusal page |

**New pages: 3.** Listing-created confirmation, owner preview, access denied.

**Ours with no original:** `/account/enquiries`, `/account/favourites`, `/account/settings`,
`/account/subscription`, `/account/listings/[id]/subscription`, `/account/listings/[id]/photos`,
`/account/listings/[id]/alerts`. All kept.

---

## 3. Admin dashboard → `apps/admin-website`

| Original view | Our route | State | Work |
|---|---|---|---|
| `Admin/Shared/_AdminLayout` | `AdminChrome` | exists | Restyle to the original's sidebar shape |
| `Dashboard/Index`, `Dashboard/Dashboard` | `/` | exists | Redesign with real counts |
| `Admin/Categories/View` | `/categories` | exists | Redesign |
| `Admin/PopularCategories/Index`, `PopularCategories/Create`, `PopularCategories/Edit` | — | **missing** | New: curate which categories lead the homepage — **DECISION 3** |
| `Admin/PopularCategories/Index_Old` | — | — | Skip: superseded in the original itself |
| `Admin/ScrollingText/Index` | — | **missing** | New: edit the marquee — **DECISION 4** |
| `BlogNew/Index` | `/blog/new` | exists | Redesign |
| `BlogEdit/Index` | `/blog/[id]` | exists | Redesign |
| `SEOArea`, `SEOListing`, `SEOPrimaryCategory`, `SEOSecondaryCategory`, `SEOSegment`, `SEOEdit/Edit` | `/seo` | exists | Our one page covers all six; add per-type filtering |
| `Audit/Dashboard` | super-admin `/audit` | exists | Stays on super-admin: reading who did what is not an admin's job |
| `Admin/Shared/AccessDenied` | — | **missing** | New |

**New pages: 3.** Popular categories, scrolling text, access denied.

**Ours with no original:** `/listings`, `/listings/[id]`, `/reports`, `/reviews`, `/locations`,
`/search`. All kept.

---

## 4. Super Admin dashboard → `apps/super-admin-website`

The largest gap. The original's super admin does a great deal ours does not.

| Original view | Our route | State | Work |
|---|---|---|---|
| `Super/Shared/_SuperLayout` | `SuperAdminChrome` | exists | Restyle |
| `Super/SuperDashboard/Login` | `/login` | exists | — |
| `Super/Dashboard/Index` | `/`, `/overview` | exists | Redesign |
| `Super/Admin/Index`, `Create`, `Edit` | `/admins` | exists | Redesign; ours also has roles and MFA |
| `Super/ConfigArea/ConfigArea` | — | **missing here** | New: areas, on the super-admin surface — **DECISION 2** |
| `Super/ConfigPrimaryCategory/PrimaryCategory` | — | **missing here** | New: categories, same question |
| `Super/ConfigSubCategory/SubCategory` | — | **missing here** | New: subcategories, same question |
| `Super/ConfigSegment/Segment` | — | **blocked** | Needs the third level — **DECISION 1** |
| `Super/ListingsByCategory/ByCategory` + `ViewByCategory` | — | **missing** | New: listing counts per category, drill in |
| `Super/ListingsByCategory/BySubCategory` + `ViewBySubCategory` | — | **missing** | New: same, one level down |
| `Super/ListingsByCategory/BySegment` + `ViewBySegment` | — | **blocked** | **DECISION 1** |
| `Super/MyListings/Index`, `Super/MyListings/ViewListing` | `/listings`, `/listings/[id]` | exists | Redesign |
| `Super/EditListing/Index` | `/listings/[id]` | partial | Add full edit, as the original allows |
| `Super/EditListingContent/Index` | — | **missing** | New: staff edit of a listing's About |
| `Super/EditListingFaqs/Index` | — | **missing** | New: staff edit of FAQs |
| `Super/EditSocialLinks/Index` | — | **missing** | New: staff edit of links |
| `Super/ViewListing/Index` | `/listings/[id]` | exists | — |
| `Super/RegisterData/Index`, `Edit`, `View` | — | **missing** | New: business accounts — id, name, email, mobile, created, status |
| `Super/SearchKeywords/Index`, `Create`, `Edit` | admin `/search` | exists elsewhere | Decide surface — **DECISION 2** |
| `Super/SearchPlaceholders/Index`, `Create`, `Edit` | admin `/search` | exists elsewhere | Decide surface — **DECISION 2** |
| `Super/UnderConstruction/Index` | — | — | Skip |

**New pages: 9.** Config area / primary category / subcategory, listings-by-category (2 pages),
listings-by-subcategory (2 pages), staff content/FAQ/links editors (3), business accounts (3).

**Ours with no original:** `/featured`, `/audit`, `/listings/new`. All kept.

---

## 5. Design, assets and responsiveness

**Reused from the original, as assets:** `Assets/images/background.jpg` (already in as the hero —
commit `939eb2c`), the logo marks (`logo.png`, `logo-tr.png`), the wave dividers (`wave*.png`),
category and segment imagery from the 537 files in `wwwroot/Assets`, and the icon set in
`Assets/plugins/icons`.

**Not reused:** the original's CSS and JavaScript. It is Bootstrap 5, jQuery 3.7, Owl Carousel and a
bought admin template; we are on Tailwind v4 with React server components. Copying the stylesheets
would mean carrying both frameworks. The *design* is reproduced in our tokens — which is what
"modernise while keeping the branding" means here.

**Branding, applied to all three sites:** the `#05677d` teal already shared by the three
`globals.css` files, Capriola for headings and Mulish for body through `next/font/google`, and the
original's logo lockup.

**Responsive:** every page above is built and checked at 375px, 768px and 1280px. The two overflow
bugs found in the last audit are already fixed; each new page gets the same check.

---

## 6. Decisions needed before anything is built

Each of these changes something the standing instruction says not to change without approval.

**DECISION 1 — the third taxonomy level (Segment).**
The original is Segment → Primary Category → Sub Category. Ours is a two-level `categories` table
(`level` is 1 or 2, enforced by a CHECK constraint). Five original views depend on the segment
level, and the public nav grouping in the screenshot (Food / Stays / Shopping / Services /
Health&Wellness / Education / Professional services) is the segment list.
*Cost:* a forward-only migration relaxing the level constraint to allow 3, plus a parent assignment
for existing categories. Additive — nothing deleted, every existing URL keeps working.
*If declined:* those five views are dropped and the nav groups become labels over the existing
top-level categories, which is cosmetic only.

**DECISION 2 — where the staff config screens live.**
The original puts areas, categories, subcategories, search keywords and placeholders on the
super-admin surface. We put areas and categories on **admin** (`/locations`, `/categories`) and
search tuning on **admin** (`/search`). Building the original's layout means either moving them or
having both. Moving them changes which permission gates them.
*My recommendation:* leave them on admin and skip the super-admin duplicates. Two copies of a
config screen is how one of them ends up un-gated. Say so if you want them moved instead.

**DECISION 3 — popular categories.**
Needs a flag on `categories` (the original's `Is Popular`). One additive column.

**DECISION 4 — scrolling text.**
Our marquee is derived from the category tree in code. The original has an editable table of text
and links. Needs one new small table plus admin CRUD.

---

## 7. Order of work, once approved

1. Decisions 1–4 settled; any migration written and applied by you.
2. Public pages: the 6 new ones, then the redesign pass.
3. Owner dashboard: 3 new pages, then the redesign pass.
4. Admin: 3 new pages, then the redesign pass.
5. Super admin: 9 new pages, then the redesign pass.
6. Responsive check at three widths across all three sites.
7. `npm run verify` plus `npm run db:check` clean before anything is proposed for commit.

**Totals: 21 new pages, 4 decisions, no page deleted, no existing feature replaced.**
