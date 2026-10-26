"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * The dashboard's navigation, in both of its forms: a fixed sidebar on a wide screen and a drawer
 * behind a toggle on a narrow one. One list of items drives both, so they can never drift apart.
 *
 * Logout is not here. It is a server action that has to revoke the refresh token, so it lives in
 * the layout as a plain form rather than a link.
 */

type NavItem = { href: string; label: string; icon: ReactNode };

const ICON_CLASS = "h-[18px] w-[18px] shrink-0";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className: ICON_CLASS,
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/account",
    label: "Overview",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/account/listings",
    label: "My Listings",
    icon: (
      <svg {...iconProps}>
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    href: "/account/listings/new",
    label: "Add New Listing",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8.5v7M8.5 12h7" />
      </svg>
    ),
  },
  {
    href: "/account/enquiries",
    label: "Enquiries",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3.5 6.5 8.5 6 8.5-6" />
      </svg>
    ),
  },
  {
    href: "/account/favourites",
    label: "Saved",
    icon: (
      <svg {...iconProps}>
        <path d="M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.8C19 15.6 12 20 12 20Z" />
      </svg>
    ),
  },
  {
    // Left out while `subscriptions` did not exist, on the rule that every item here must reach a
    // working page. The table exists now, and so does a way to buy the plan.
    href: "/account/subscription",
    label: "Plans & Payment",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="5.5" width="18" height="13" rx="2" />
        <path d="M3 10h18M6.5 14.5h4" />
      </svg>
    ),
  },
  {
    href: "/account/profile",
    label: "Business Profile",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
      </svg>
    ),
  },
  {
    href: "/account/settings",
    label: "Account Settings",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
      </svg>
    ),
  },
];

/**
 * Which item is highlighted: the one whose href is the longest prefix of the current path.
 * "Add New Listing" and "My Listings" would otherwise both match /account/listings/new.
 */
function activeHref(pathname: string): string | null {
  const matches = NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const active = activeHref(pathname);
  return (
    <ul className="grid gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === active;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
                isActive
                  ? "bg-brand-700 text-white"
                  : "text-brand-800 hover:bg-brand-50 hover:text-brand-700"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The sidebar as it appears on a wide screen. */
export function AccountSidebarNav() {
  const pathname = usePathname();
  return <NavList pathname={pathname} />;
}

/** The toggle and drawer for narrow screens. */
export function AccountDrawerNav({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Following a link inside the drawer should close it.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="account-drawer"
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-bold text-brand-800 lg:hidden"
      >
        <span aria-hidden="true">&#9776;</span>
        Menu
      </button>

      {open ? (
        <div id="account-drawer" className="mt-3 rounded-xl border border-line bg-white p-3 shadow-sm lg:hidden">
          <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          {children ? <div className="mt-2 border-t border-line pt-2">{children}</div> : null}
        </div>
      ) : null}
    </>
  );
}
