"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The signed-in owner's menu, in place of the Login button.
 *
 * It is the same menu everywhere, including inside the dashboard — one component rather than two
 * that drift apart, and the extra links do no harm on a page that already has them in its sidebar.
 *
 * Logout is not a link. It revokes the refresh token on the server, so it has to be a form posting
 * a server action; the action is passed in from the server component that renders this, because a
 * client component cannot import one from a route it does not belong to.
 */
export function ProfileMenu({
  name,
  phone,
  signOut,
}: {
  name: string | null;
  phone: string;
  signOut: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Navigating away must close it: the menu is rendered by a layout, so it survives a route change
  // and would otherwise hang open over the new page.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Two letters from the name, or the last two digits of the phone when there is no name yet.
  const initials = (name?.trim() || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || phone.slice(-2);

  return (
    <div ref={container} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex cursor-pointer items-center gap-2 rounded-full border border-line py-1.5 pr-3 pl-1.5 hover:border-brand-700 hover:bg-brand-50"
      >
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-full bg-brand-700 text-xs font-black text-white"
        >
          {initials}
        </span>
        <span className="hidden max-w-[120px] truncate text-sm font-bold text-brand-800 sm:block">
          {name?.trim() || "My account"}
        </span>
        <svg viewBox="0 0 12 8" aria-hidden="true" className="h-2 w-3 fill-current text-brand-700">
          <path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Account menu</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-2 w-60 rounded-xl border border-line bg-white p-2 shadow-[0_18px_40px_#002a3426]"
        >
          {/* Who you are signed in as. Not a link: it is the answer to "whose account is this?",
              which is the first thing this menu exists to show. */}
          <div className="border-b border-line px-3 pt-2 pb-3">
            <p className="truncate text-sm font-black text-brand-800">{name?.trim() || "Your account"}</p>
            <p className="mt-0.5 truncate text-xs text-muted">{phone}</p>
          </div>

          <Link href="/account" role="menuitem" className={ITEM_CLASS}>
            Your profile
          </Link>
          <Link href="/account/listings" role="menuitem" className={ITEM_CLASS}>
            Your listings
          </Link>
          <Link href="/help" role="menuitem" className={ITEM_CLASS}>
            Help &amp; feedback
          </Link>

          <div className="mt-1 border-t border-line pt-1">{signOut}</div>
        </div>
      ) : null}
    </div>
  );
}

const ITEM_CLASS =
  "block rounded-lg px-3 py-2.5 text-sm font-bold text-ink hover:bg-brand-50 hover:text-brand-700";
