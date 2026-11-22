"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { MiniaNavItem } from "./nav";

/**
 * The sidebar list, in place of metisMenu.
 *
 * metisMenu is a jQuery plugin: it rewrites the DOM React owns, which is how hydration breaks. It
 * does only two things worth keeping, and both are state, so React does them better — a group is
 * open or closed, and the row you are on is marked. The class names below are metisMenu's own
 * (`mm-active`, `mm-collapse`, `mm-show`), because app.min.css styles those exact names: the
 * chevron rotation, the sub-menu reveal and the active colour are the theme's, not ours.
 *
 * The group holding the current page starts open, the way metisMenu did on load, and opening
 * another closes it — the original's accordion behaviour.
 */

/** The `plan` filter a row or a URL carries, with its absence spelled out as "every plan". */
function planOf(query: string): string {
  return new URLSearchParams(query).get("plan") ?? "";
}

function isCurrent(pathname: string, search: string, href: string): boolean {
  const [path, query = ""] = href.split("?");

  // The two dashboards are prefixes of everything on their surface, so they match exactly or not
  // at all; every other row may also be the parent of a detail page.
  if (path === "/admin" || path === "/super-admin/overview") return pathname === path;

  /* All, Free and Verified Listings are one page with one filter between them, so the path alone
     cannot tell them apart -- compared on the path only, all three would light up at once. The
     filter decides, and no filter is itself a value. */
  if (pathname === path) return planOf(query) === planOf(search);

  return pathname.startsWith(`${path}/`);
}

/**
 * Which group, if any, contains the page being shown.
 *
 * Matched on the path alone, deliberately: a group holding All, Free and Verified Listings should
 * open on any of them, not only on the one whose filter is in the address.
 */
function groupForPath(items: MiniaNavItem[], pathname: string): string | null {
  for (const item of items) {
    if (item.children?.some((child) => child.href && isCurrent(pathname, "", child.href.split("?")[0] ?? child.href))) {
      return item.label;
    }
  }
  return null;
}

export function SidebarMenu({ items }: { items: MiniaNavItem[] }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [open, setOpen] = useState<string | null>(() => groupForPath(items, pathname));

  // Following a link into another group opens that group, as metisMenu did on each page load.
  useEffect(() => {
    const group = groupForPath(items, pathname);
    if (group) setOpen(group);
  }, [pathname, items]);

  return (
    <div id="sidebar-menu">
      <ul className="metismenu list-unstyled" id="side-menu">
        {items.map((item) =>
          item.children ? (
            <Group
              key={item.label}
              item={item}
              pathname={pathname}
              search={search}
              open={open === item.label}
              onToggle={() => setOpen((current) => (current === item.label ? null : item.label))}
            />
          ) : (
            <Row key={item.label} item={item} pathname={pathname} search={search} />
          ),
        )}
      </ul>
    </div>
  );
}

function Group({
  item,
  pathname,
  search,
  open,
  onToggle,
}: {
  item: MiniaNavItem;
  pathname: string;
  search: string;
  open: boolean;
  onToggle: () => void;
}) {
  const holdsCurrent = item.children?.some(
    (child) => child.href && isCurrent(pathname, search, child.href),
  );
  return (
    <li className={open || holdsCurrent ? "mm-active" : undefined}>
      <button
        type="button"
        className="minia-nav-btn has-arrow"
        aria-expanded={open}
        onClick={onToggle}
      >
        {item.icon ? <i className={item.icon} /> : null}
        <span>{item.label}</span>
      </button>
      <ul className={`sub-menu mm-collapse${open ? " mm-show" : ""}`}>
        {item.children?.map((child) => (
          <Row key={child.label} item={child} pathname={pathname} search={search} nested />
        ))}
      </ul>
    </li>
  );
}

function Row({
  item,
  pathname,
  search,
  nested = false,
}: {
  item: MiniaNavItem;
  pathname: string;
  search: string;
  nested?: boolean;
}) {
  /* A row the original had but this backend cannot serve. It keeps its place and its shape and is
     deliberately not a link: a dead row is honest, a link to a page that 404s is not. */
  if (item.comingSoon || !item.href) {
    return (
      <li>
        <span className="minia-nav-btn minia-coming-soon" aria-disabled="true">
          {!nested && item.icon ? <i className={item.icon} /> : null}
          <span>{item.label}</span>
          <span className="badge bg-light text-muted ms-2">Coming Soon</span>
        </span>
      </li>
    );
  }

  /* The page exists, but on the other sign-in. Following it would bounce you to that surface's
     login, which reads as being logged out at random — so the row says where the screen lives
     instead of pretending it is one click away. */
  if (item.otherSurface) {
    return (
      <li>
        <span
          className="minia-nav-btn minia-coming-soon"
          aria-disabled="true"
          title={`This screen is on the ${item.otherSurface === "super" ? "Super Admin" : "Admin"} panel. Sign in there to open it.`}
        >
          {!nested && item.icon ? <i className={item.icon} /> : null}
          <span>{item.label}</span>
          <span className="badge bg-light text-muted ms-2">
            {item.otherSurface === "super" ? "Super Admin" : "Admin"}
          </span>
        </span>
      </li>
    );
  }

  const current = isCurrent(pathname, search, item.href);
  return (
    <li className={current ? "mm-active" : undefined}>
      <Link
        href={item.href}
        className={current ? "active" : undefined}
        aria-current={current ? "page" : undefined}
      >
        {!nested && item.icon ? <i className={item.icon} /> : null}
        <span>{item.label}</span>
      </Link>
    </li>
  );
}
