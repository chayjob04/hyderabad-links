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
 * The Admin sidebar.
 *
 * The original's "Listings" group held Add listing and My listings; the business-owner rows beside
 * them belonged to a fourth role this application does not have, so they are not here. Everything
 * else is row for row.
 */
export const ADMIN_NAV: MiniaNavItem[] = [
  { label: "Dashboard", href: "/admin", icon: "fas fa-tachometer-alt" },
  {
    label: "Listings",
    icon: "fas fa-newspaper",
    children: [
      { label: "My listings", href: "/admin/listings", permission: PERM.listingsView },
      { label: "Reviews", href: "/admin/reviews", permission: PERM.listingsReview },
      { label: "Reports", href: "/admin/reports", permission: PERM.reportsHandle },
    ],
  },
  {
    label: "Home page",
    icon: "fas fa-home",
    permission: PERM.homepageManage,
    children: [
      { label: "Scrolling", href: "/admin/homepage/scrolling-text" },
      { label: "Popular categories", href: "/admin/homepage/popular-categories" },
      { label: "Verified listing", href: "/super-admin/featured", permission: PERM.listingsFeature },
      { label: "Trending", comingSoon: true },
      { label: "Endless listing", comingSoon: true },
    ],
  },
  { label: "SEO Home", href: "/admin/seo", icon: "fas fa-chart-line", permission: PERM.seoManage },
  { label: "Blog Home", href: "/admin/blog", icon: "fas fa-blog", permission: PERM.blogManage },
  {
    label: "Categories view",
    href: "/admin/categories",
    icon: "fas fa-list",
    permission: PERM.taxonomyManage,
  },
  { label: "Locations", href: "/admin/locations", icon: "fas fa-map-marker-alt", permission: PERM.taxonomyManage },
  { label: "Search", href: "/admin/search", icon: "fas fa-search", permission: PERM.taxonomyManage },
  { label: "Audit Dashboard", href: "/super-admin/audit", icon: "fas fa-history", permission: PERM.auditView },
  { label: "My password", href: "/admin/password", icon: "fas fa-key" },
];

/**
 * The Super Admin sidebar.
 *
 * The original pointed a dozen rows at `/Super/UnderConstruction`. They are kept, in their original
 * groups and order, as `comingSoon` rows: the shape of the menu is part of what is being
 * reproduced, and an inert row is honest where a link to a missing page would not be.
 */
export const SUPER_ADMIN_NAV: MiniaNavItem[] = [
  { label: "Dashboard", href: "/super-admin/overview", icon: "fas fa-tachometer-alt" },
  {
    label: "Listings",
    icon: "fas fa-boxes",
    children: [
      { label: "By Category", href: "/super-admin/listings/by-category", permission: PERM.listingsView },
      { label: "By Subcategory", href: "/super-admin/listings/by-subcategory", permission: PERM.listingsView },
      { label: "By Area", comingSoon: true },
      { label: "By Admin", comingSoon: true },
      { label: "By Plan", comingSoon: true },
      { label: "Recent", href: "/super-admin/listings", permission: PERM.listingsView },
      { label: "Add Listings", href: "/super-admin/listings/new", permission: PERM.listingsCreate },
      { label: "MyListings", href: "/super-admin/listings", permission: PERM.listingsView },
    ],
  },
  { label: "SEO Home", href: "/admin/seo", icon: "fas fa-chart-line", permission: PERM.seoManage },
  {
    label: "Analytics",
    icon: "fas fa-chart-bar",
    permission: PERM.analyticsView,
    children: [{ label: "Dashboard", comingSoon: true }],
  },
  {
    label: "Subscriptions",
    icon: "fas fa-money-bill-alt",
    permission: PERM.plansManage,
    children: [
      { label: "Dashboard", comingSoon: true },
      { label: "Report", comingSoon: true },
    ],
  },
  {
    label: "Business accounts",
    icon: "fas fa-award",
    permission: PERM.usersView,
    children: [{ label: "Accounts", href: "/super-admin/accounts" }],
  },
  {
    label: "Home page",
    icon: "fas fa-home",
    permission: PERM.homepageManage,
    children: [
      { label: "Scrolling", href: "/admin/homepage/scrolling-text" },
      { label: "Popular categories", href: "/admin/homepage/popular-categories" },
      { label: "Verified listing", href: "/super-admin/featured", permission: PERM.listingsFeature },
      { label: "Trending", comingSoon: true },
      { label: "Endless listing", comingSoon: true },
    ],
  },
  {
    label: "Mixed",
    icon: "fas fa-adjust",
    children: [
      { label: "Blogs", href: "/admin/blog", permission: PERM.blogManage },
      { label: "Plans", comingSoon: true },
      { label: "Features", comingSoon: true },
      { label: "Audit Dashboard", href: "/super-admin/audit", permission: PERM.auditView },
    ],
  },
  {
    label: "Configurations",
    icon: "fas fa-cogs",
    children: [
      { label: "Admins", href: "/super-admin/admins", permission: PERM.adminsManage },
      { label: "Area", href: "/admin/locations", permission: PERM.taxonomyManage },
      { label: "Listing Group", comingSoon: true },
      { label: "Categories view", href: "/admin/categories", permission: PERM.taxonomyManage },
      { label: "Primary category", href: "/admin/categories", permission: PERM.taxonomyManage },
      { label: "Sub category", href: "/admin/categories", permission: PERM.taxonomyManage },
      { label: "Segment", comingSoon: true },
      { label: "Manage SearchKeys", href: "/admin/search", permission: PERM.taxonomyManage },
      { label: "Manage PlaceholderText", href: "/admin/search", permission: PERM.taxonomyManage },
      { label: "Manage Register Data", comingSoon: true },
    ],
  },
  { label: "My password", href: "/super-admin/password", icon: "fas fa-key" },
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

  const mark = (item: MiniaNavItem): MiniaNavItem =>
    item.href && !onThisSurface(item.href) ? { ...item, otherSurface: other } : item;

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
