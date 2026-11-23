/**
 * The two sidebar menus, transcribed from the original application's Razor layouts.
 *
 * Admin comes from `Views/Admin/Shared/_AdminLayout.cshtml`, Super Admin from
 * `Views/Super/Shared/_SuperLayout.cshtml`. The order, the grouping, the labels and the Font
 * Awesome icon on every row are the original's — this file is data, so the markup that renders it
 * can stay identical for both surfaces.
 *
 * Three fields decide what a row does:
 *
 *   `href`        where it goes in THIS application. Null means there is nowhere to go.
 *   `permission`  the row is hidden unless the signed-in account holds it. The original decided
 *                 this with a numeric RoleID (1 = full admin, 2 = delegated, 3 = editor, 4 = owner);
 *                 we have real permission codes, so we use those. No role numbers are invented.
 *   `comingSoon`  the original had the row but this backend cannot serve it. It renders, greyed,
 *                 with a "Coming Soon" badge, and it is not a link — so the navigation keeps its
 *                 original shape without offering a route that would 404.
 */

export type MiniaNavItem = {
  label: string;
  href?: string | null;
  /** Font Awesome 5 class, exactly as the original Razor wrote it. */
  icon?: string;
  /** Hidden unless the account holds this permission code. Omitted means always visible. */
  permission?: string;
  /** Rendered but inert: the original had it, this backend does not. */
  comingSoon?: boolean;
  /**
   * Set by `visibleNav`, never by hand: this row's page lives on the *other* staff surface.
   *
   * A session holds one surface's cookies and no more — signing in on super-admin writes
   * `hl_super_*` and nothing else. So a sidebar row pointing across surfaces hits the middleware
   * with no cookie for the surface it names, and gets bounced to that surface's sign-in. From the
   * inside that looks exactly like being logged out at random, which is how it was reported.
   */
  otherSurface?: "admin" | "super";
  children?: MiniaNavItem[];
};

/* Permission codes, mirrored from backend/BusinessDirectory.Api/Auth/AdminPermissions.cs. Strings
   rather than an import, because that file is C# — the two lists are checked against each other by
   a test in scripts/, not by the compiler. */
export const PERM = {
  listingsView: "listings.view",
  listingsReview: "listings.review",
  listingsCreate: "listings.create",
  listingsEdit: "listings.edit",
  listingsFeature: "listings.feature",
  reportsHandle: "reports.handle",
  taxonomyManage: "taxonomy.manage",
  seoManage: "seo.manage",
  blogManage: "blog.manage",
  homepageManage: "homepage.manage",
  usersView: "users.view",
  analyticsView: "analytics.view",
  plansManage: "plans.manage",
  adminsManage: "admins.manage",
  auditView: "audit.view",
} as const;

/**
 * Every status at once. Mirrors `ModerationQueueQuery.AllStatuses`: the admin queue defaults to the
 * review queue, so All Listings has to ask for all of them explicitly.
 */
const ALL = "all";

/**
 * The Admin sidebar.
 *
 * The original's "Listings" group held Add listing and My listings; the business-owner rows beside
 * them belonged to a fourth role this application does not have, so they are not here. Everything
 * else is row for row.
 */
/**
 * The Admin sidebar.
 *
 * Grouped by what a thing is rather than by where it came from. The Listings group is the three
 * views that matter -- everything, free, paid -- and nothing else: "My listings" was never anybody's
 * own listings, it was the moderation queue under a name that implied ownership.
 *
 * Rows whose page is served by the super-admin surface are gated on a super-only permission, so an
 * administrator never sees them: `visibleNav` drops a row the account cannot hold.
 */
export const ADMIN_NAV: MiniaNavItem[] = [
  { label: "Dashboard", href: "/admin", icon: "fas fa-tachometer-alt" },
  {
    label: "Listings",
    icon: "fas fa-newspaper",
    permission: PERM.listingsView,
    children: [
      { label: "All Listings", href: `/admin/listings?status=${ALL}` },
      { label: "Free Listings", href: `/admin/listings?status=${ALL}&plan=free` },
      { label: "Verified Listings", href: `/admin/listings?status=${ALL}&plan=verified` },
    ],
  },
  {
    label: "Reviews & Reports",
    icon: "fas fa-comments",
    children: [
      { label: "Reviews", href: "/admin/reviews", permission: PERM.listingsReview },
      { label: "Reports", href: "/admin/reports", permission: PERM.reportsHandle },
      /* Edits to listings that are already on the site. The same permission as the listing queue:
         it is the same judgement about the same content (S0031). */
      { label: "Listing Changes", href: "/admin/listing-changes", permission: PERM.listingsReview },
    ],
  },
  {
    label: "Website Management",
    icon: "fas fa-globe",
    children: [
      // One page manages both levels of the tree, so one row names both rather than two rows
      // pointing at the same screen.
      { label: "Categories & Subcategories", href: "/admin/categories", permission: PERM.taxonomyManage },
      { label: "Areas / Locations", href: "/admin/locations", permission: PERM.taxonomyManage },
      { label: "Requests", href: "/admin/suggestions", permission: PERM.taxonomyManage },
      { label: "Listing Groups", href: "/super-admin/featured", permission: PERM.listingsFeature },
    ],
  },
  { label: "SEO Management", href: "/admin/seo", icon: "fas fa-chart-line", permission: PERM.seoManage },
  { label: "Search Management", href: "/admin/search", icon: "fas fa-search", permission: PERM.taxonomyManage },
  {
    label: "Content Management",
    icon: "fas fa-blog",
    children: [
      { label: "Blog", href: "/admin/blog", permission: PERM.blogManage },
      { label: "Homepage strip", href: "/admin/homepage/scrolling-text", permission: PERM.homepageManage },
      { label: "Popular categories", href: "/admin/homepage/popular-categories", permission: PERM.homepageManage },
    ],
  },
  { label: "My Password", href: "/admin/password", icon: "fas fa-key" },
];

/**
 * The Super Admin sidebar: the Admin menu, plus what only a platform owner can do.
 *
 * Every Admin row is here and reachable, because a super sign-in now keeps the admin session as
 * well (see `app/login/actions.ts`). Before that, the rows served from /admin had to be drawn inert
 * with an "Admin" badge, which read as a restriction on the most privileged account in the system.
 *
 * The original pointed a dozen rows at `/Super/UnderConstruction`. Those are gone rather than
 * greyed: a menu that lists what does not exist costs more to read than it gains in shape. What
 * each of them would have shown, where it exists at all, is reachable from the rows below.
 */
export const SUPER_ADMIN_NAV: MiniaNavItem[] = [
  { label: "Dashboard", href: "/super-admin/overview", icon: "fas fa-tachometer-alt" },
  {
    label: "Listings",
    icon: "fas fa-boxes",
    permission: PERM.listingsView,
    children: [
      { label: "All Listings", href: "/super-admin/listings" },
      { label: "Free Listings", href: "/super-admin/listings?plan=free" },
      { label: "Verified Listings", href: "/super-admin/listings?plan=verified" },
    ],
  },
  {
    label: "Reviews & Reports",
    icon: "fas fa-comments",
    children: [
      { label: "Reviews", href: "/admin/reviews", permission: PERM.listingsReview },
      { label: "Reports", href: "/admin/reports", permission: PERM.reportsHandle },
      { label: "Listing Changes", href: "/admin/listing-changes", permission: PERM.listingsReview },
    ],
  },
  {
    label: "Website Management",
    icon: "fas fa-globe",
    children: [
      { label: "Categories & Subcategories", href: "/admin/categories", permission: PERM.taxonomyManage },
      { label: "Areas / Locations", href: "/admin/locations", permission: PERM.taxonomyManage },
      /* Owners asking for an area or a category we do not have. Same permission as the two rows
         above, because approving one creates exactly what they create (S0032). */
      { label: "Requests", href: "/admin/suggestions", permission: PERM.taxonomyManage },
      { label: "Listing Groups", href: "/super-admin/featured", permission: PERM.listingsFeature },
      // Counts per category and per subcategory, each drilling in to the listings filed under it.
      { label: "Listings by Category", href: "/super-admin/listings/by-category", permission: PERM.listingsEdit },
      { label: "Listings by Subcategory", href: "/super-admin/listings/by-subcategory", permission: PERM.listingsEdit },
    ],
  },
  { label: "SEO Management", href: "/admin/seo", icon: "fas fa-chart-line", permission: PERM.seoManage },
  { label: "Search Management", href: "/admin/search", icon: "fas fa-search", permission: PERM.taxonomyManage },
  {
    label: "Content Management",
    icon: "fas fa-blog",
    children: [
      { label: "Blog", href: "/admin/blog", permission: PERM.blogManage },
      { label: "Homepage strip", href: "/admin/homepage/scrolling-text", permission: PERM.homepageManage },
      { label: "Popular categories", href: "/admin/homepage/popular-categories", permission: PERM.homepageManage },
    ],
  },
  { label: "Business Accounts", href: "/super-admin/accounts", icon: "fas fa-award", permission: PERM.usersView },
  /* Who is paying and until when. Read-only: the screen says so, because granting a plan or
     refunding a payment is money and has no endpoint. */
  {
    label: "Subscription Management",
    href: "/super-admin/subscriptions",
    icon: "fas fa-rupee-sign",
    permission: PERM.plansManage,
  },
  { label: "Admin Management", href: "/super-admin/admins", icon: "fas fa-cogs", permission: PERM.adminsManage },
  { label: "Audit Logs", href: "/super-admin/audit", icon: "fas fa-history", permission: PERM.auditView },
  { label: "My Password", href: "/super-admin/password", icon: "fas fa-key" },
];

/**
 * Drops the rows this account may not see, and any group left with no children.
 *
 * It also enforces the one rule a staff sidebar cannot break: **a row may only link to a route on
 * its own surface.** Anything pointing across is marked `otherSurface` and rendered inert, because
 * following it would bounce the person to the other sign-in — they hold one surface's cookies, not
 * both. Doing it here rather than by hand means a row added later cannot reintroduce the bug: the
 * menus are free to describe the original's hierarchy, and this decides what is actually clickable.
 */
export function visibleNav(
  items: MiniaNavItem[],
  permissions: readonly string[],
  /** The surface these menus are being drawn on. */
  surface: "admin" | "super",
): MiniaNavItem[] {
  const prefix = surface === "super" ? "/super-admin" : "/admin";
  const other = surface === "super" ? "admin" : "super";

  const allowed = (item: MiniaNavItem) => !item.permission || permissions.includes(item.permission);

  /* `/admin` is a prefix of nothing else, but `/super-admin` is not a prefix of `/admin` — so a
     plain startsWith is enough in one direction and wrong in the other. Comparing the first path
     segment is exact either way. */
  const onThisSurface = (href: string) => href === prefix || href.startsWith(`${prefix}/`);

  /* A super-admin sign-in keeps the admin session as well, so a row pointing at /admin is
     reachable from the super surface and must not be marked. The reverse still is: an admin session
     holds no super cookie, and following such a row would bounce them to the other sign-in. */
  const reachable = (href: string) => onThisSurface(href) || surface === "super";

  const mark = (item: MiniaNavItem): MiniaNavItem =>
    item.href && !reachable(item.href) ? { ...item, otherSurface: other } : item;

  const result: MiniaNavItem[] = [];
  for (const item of items) {
    if (!allowed(item)) continue;
    if (!item.children) {
      result.push(mark(item));
      continue;
    }
    const children = item.children.filter(allowed).map(mark);
    // A group whose every row was hidden would otherwise open onto nothing.
    if (children.length > 0) result.push({ ...item, children });
  }
  return result;
}
