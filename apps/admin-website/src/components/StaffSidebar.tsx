"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavItem = { href: string; label: string; mark: string };

/**
 * The dark sidebar the original's admin template is built around, rebuilt in our own tokens.
 *
 * It is a client component for one reason: the current route has to be marked, and on a phone the
 * panel has to open and close. Everything it shows is already public to a signed-in member of
 * staff, so nothing sensitive crosses the boundary.
 *
 * Every link is shown to everyone signed in. The API refuses a screen the account has no
 * permission for and the page explains the refusal — hiding a link has never been the control.
 */
export function StaffSidebar({
  title,
  items,
  footer,
}: {
  title: string;
  items: NavItem[];
  /** The signed-in name and the way out, rendered at the bottom. */
  footer: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  /* The most specific item that matches, not every item that matches. With both /listings and
     /listings/by-category in the list, a prefix test marks two rows at once and announces
     aria-current="page" twice, which is simply wrong -- only one of them is the page. */
  const current = items
    .filter(
      (item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const isCurrent = (href: string) => href === current;

  return (
    <>
      {/* The phone header. The sidebar itself is off-canvas below `lg`. */}
      <div className="flex items-center justify-between gap-3 bg-brand-900 px-4 py-3 text-white lg:hidden">
        <span className="text-sm font-black tracking-[0.18em]">{title}</span>
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-controls="staff-nav"
          className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-bold hover:bg-white/10"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      <nav
        id="staff-nav"
        aria-label={title}
        className={`${open ? "block" : "hidden"} w-full shrink-0 bg-brand-900 text-white lg:block lg:min-h-screen lg:w-[250px]`}
      >
        <div className="hidden px-5 py-5 lg:block">
          <Link href="/" className="text-sm font-black tracking-[0.18em] text-white hover:opacity-80">
            {title}
          </Link>
        </div>

        <ul className="px-3 pb-4 lg:pb-8">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isCurrent(item.href) ? "page" : undefined}
                className={`mt-0.5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
                  isCurrent(item.href)
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span aria-hidden="true" className="w-5 text-center text-base">
                  {item.mark}
                </span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="border-t border-white/15 px-5 py-4 text-sm text-white/70">{footer}</div>
      </nav>
    </>
  );
}
