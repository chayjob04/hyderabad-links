"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * The customer dashboard's navigation, in both of its forms: a fixed sidebar on a wide screen and a
 * drawer behind a toggle on a narrow one. One list drives both, so they cannot drift apart.
 *
 * This is a customer's account and nothing else — saved businesses, chat, their own details, help.
 * There are no listings here, no enquiries and no plans, because a customer has none of those
 * things. Registering a business is a different account on a different sign-in, which is what
 * "List your business" leads to.
 *
 * Logout is not in the list. It is a server action that has to revoke the refresh token, so it
 * lives in the layout as a plain form rather than a link.
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
    href: "/my/saved",
    label: "Saved",
    icon: (
      <svg {...iconProps}>
        <path d="M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.8C19 15.6 12 20 12 20Z" />
      </svg>
    ),
  },
  {
    href: "/my/chat",
    label: "Chat",
    icon: (
      <svg {...iconProps}>
        <path d="M20 13.5a3 3 0 0 1-3 3H9l-4 3.5v-3.5H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" />
      </svg>
    ),
  },
  {
    href: "/my/profile",
    label: "Profile",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
      </svg>
    ),
  },
  {
    // A public page, deliberately: support is the same page whether or not you are signed in.
    href: "/help",
    label: "Help & Support",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4" />
        <path d="M12 16.6h.01" />
      </svg>
    ),
  },
];

function activeHref(pathname: string): string | null {
  const matches = NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}

/**
 * The one way across to the business side. It opens the information page, not a form: somebody
 * clicking this has not decided to list a business, they are asking what listing one would mean.
 * The Register buttons there lead to the business sign-in, which is a separate account.
 */
function ListYourBusiness({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/list-your-business"
      onClick={onNavigate}
      className="mt-3 flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm font-bold text-brand-800 transition hover:border-brand-700 hover:bg-brand-100"
    >
      <svg {...iconProps}>
        <path d="M4 9.5 5.5 5h13L20 9.5" />
        <path d="M4 9.5a2.4 2.4 0 0 0 4 1.6 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4-1.6" />
        <path d="M5.5 11.8V19h13v-7.2" />
      </svg>
      List your business
    </Link>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const active = activeHref(pathname);
  return (
    <>
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
      <ListYourBusiness onNavigate={onNavigate} />
    </>
  );
}

/** The sidebar as it appears on a wide screen. */
export function CustomerSidebarNav() {
  const pathname = usePathname();
  return <NavList pathname={pathname} />;
}

/** The toggle and drawer for narrow screens. */
export function CustomerDrawerNav({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Following a link inside the drawer should close it.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="customer-drawer"
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-bold text-brand-800 lg:hidden"
      >
        <span aria-hidden="true">&#9776;</span>
        Menu
      </button>

      {open ? (
        <div id="customer-drawer" className="mt-3 rounded-xl border border-line bg-white p-3 shadow-sm lg:hidden">
          <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          {children ? <div className="mt-2 border-t border-line pt-2">{children}</div> : null}
        </div>
      ) : null}
    </>
  );
}
