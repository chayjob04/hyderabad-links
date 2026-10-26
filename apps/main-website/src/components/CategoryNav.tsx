"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { navLabel } from "@/lib/categories";
import type { Category } from "@/lib/types";

/**
 * The header's category navigation, built from the real two-level category tree.
 *
 * On a wide screen each parent category is a disclosure button that opens a mega-menu panel of its
 * sub-categories; on a narrow one the same tree stacks behind the ☰ toggle. Every entry is a real
 * link into its own page -- `/food` for the parent, `/food/cafes` for a child -- because the
 * API already treats a parent slug as matching its sub-categories.
 *
 * The buttons are disclosures rather than links so that a keyboard user can reach the
 * sub-categories at all: a link that opened on hover alone would be unreachable without a mouse.
 *
 * This is a client component because the panel needs open/closed state. The category data itself
 * is fetched on the server and passed in, so the browser still never calls the API.
 */

/**
 * How many parent categories can appear on the bar. Only the first five are shown on every screen
 * that has the bar at all; the sixth and seventh appear as the viewport allows (see SLOT_CLASS).
 * Nothing is lost by hiding them, because "All categories" lists every parent.
 */
const NAV_SLOTS = 7;

/**
 * Narrower screens show fewer shortcuts. Seventeen real category names never fit one row, and the
 * names are long ("Construction and Interiors"), so the later slots drop out rather than overflow.
 *
 * These counts are measured, not guessed. The nav sits in a flex row between the brand and the
 * sign-in button, and its content can overrun that box *without the page itself scrolling*, which
 * shows up as the nav colliding with the sign-in button rather than as a scrollbar. Checking
 * `document.scrollWidth` alone therefore misses it; the test is `nav.scrollWidth > nav.clientWidth`.
 *
 * The bar shows short labels (navLabel), and that is what makes this work at all. The real names
 * run to 178px ("Education and Training"), and five of those plus a logo and an account button do
 * not share a row at any width -- which is why the previous answer, dropping shortcuts until the
 * rest fit, ended up hiding most of the directory behind one menu. Abbreviated they are 45-85px,
 * plus 28px of chip padding, against a nav box of roughly 640px at 1024, 890px at 1280 and 1138px
 * at 1536.
 *
 * That fits four shortcuts up to 1279, six to 1535 and all seven beyond, with "All categories"
 * always present. The last ones dropping out on a narrow screen loses nothing: that menu lists
 * every parent.
 *
 * Re-measure after changing this, the labels, the type scale, the chip padding or the gaps.
 */
const SLOT_CLASS = ["", "", "", "", "hidden xl:block", "hidden xl:block", "hidden 2xl:block"];

/** The "All categories" disclosure shares the one open-panel state, so it needs a key of its own. */
const ALL = "__all__";

/**
 * Leaving a trigger does not close its panel instantly. Crossing the hairline between the button
 * and the panel momentarily leaves both, and without this the menu flickers shut under the pointer.
 */
const CLOSE_DELAY_MS = 180;

/**
 * And opening waits a moment too. Without it the panels fire the instant the pointer crosses them,
 * so sweeping the bar on the way to something else flashes three menus open and shut.
 *
 * Long enough now to be read as a deliberate pause rather than as lag — but it is only paid once:
 * hoverOpen skips the wait while a panel is already showing, so moving along the bar still tracks
 * the pointer.
 */
const OPEN_DELAY_MS = 200;

/**
 * Which panel is open, and whether a click put it there.
 *
 * `pinned` is what makes hover and click coexist. Hovering opens a panel unpinned, so moving the
 * pointer away closes it again. Clicking pins it, so it stays until the next click or Escape.
 * Without the distinction a click on an already-hovered trigger reads as "toggle" and shuts the
 * panel the hover just opened, which makes clicking look broken.
 */
type OpenState = { slug: string; pinned: boolean } | null;

const PANEL_CLASS =
  "category-panel absolute top-full left-1/2 z-30 w-[min(1100px,90vw)] -translate-x-1/2 rounded-b-xl border border-t-0 border-line bg-white p-6 shadow-[0_18px_40px_#002a3426]";

const PANEL_LINK_CLASS =
  "block rounded-md px-2 py-2 text-sm font-semibold text-ink hover:bg-brand-50 hover:text-brand-700";

/*
 * Each category reads as its own soft chip rather than bare text in a crowded row. The vertical
 * padding moved onto the wrapper below so the chip can be short while the nav keeps its height --
 * the panel is positioned against the nav, so shrinking it would slide the menu up into the header.
 */
const TRIGGER_CLASS =
  "flex cursor-pointer items-center gap-1.5 rounded-full bg-brand-50/60 px-3.5 py-2.5 text-[13px] font-bold whitespace-nowrap text-brand-800 transition-colors duration-200 ease-out hover:bg-brand-100 hover:text-brand-700 motion-reduce:transition-none xl:text-[15px]";

/** Keeps the bar the height it was, now that the chip itself is short. */
const SLOT_PADDING = "py-3";

/** A chevron that turns over when its panel opens. An SVG, so the rotation can be animated. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 8"
      /* 300ms on the panel's own easing. At 150ms the arrow had finished flicking over before the
         menu had begun to open, so the two read as separate events rather than one gesture. */
      className={`h-2 w-3 shrink-0 fill-current text-brand-700 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        open ? "rotate-180" : ""
      }`}
    >
      <path d="M1.2 1.3 6 6l4.8-4.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CategoryNav({ tree }: { tree: Category[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<OpenState>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function cancelOpen() {
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }

  /**
   * Hovering opens a panel after a short wait, and never steals one the visitor clicked open.
   * The wait is skipped when a panel is already showing: moving along the bar from one open menu
   * to the next should track the pointer, not lag behind it.
   */
  function hoverOpen(slug: string) {
    cancelClose();
    cancelOpen();
    const show = () => setOpen((current) => (current?.slug === slug ? current : { slug, pinned: false }));
    if (open) {
      show();
      return;
    }
    openTimer.current = setTimeout(show, OPEN_DELAY_MS);
  }

  /** Only an unpinned (hover-opened) panel closes when the pointer leaves it. */
  function scheduleClose() {
    cancelOpen();
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setOpen((current) => (current?.pinned ? current : null));
    }, CLOSE_DELAY_MS);
  }

  function toggle(slug: string) {
    cancelOpen();
    cancelClose();
    setOpen((current) => (current?.slug === slug && current.pinned ? null : { slug, pinned: true }));
  }

  function close(returnFocusTo?: string) {
    cancelOpen();
    cancelClose();
    setOpen(null);
    if (returnFocusTo) buttonRefs.current.get(returnFocusTo)?.focus();
  }

  // Arriving on a new page should not leave the menu hanging open behind it.
  useEffect(() => {
    setOpen(null);
    setMobileOpen(false);
  }, [pathname]);

  // A click anywhere else on the page closes the open panel, pinned or not.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Never leave a timer running after the component goes away.
  useEffect(
    () => () => {
      cancelClose();
      cancelOpen();
    },
    [],
  );

  if (tree.length === 0) return null;

  /* Inside the dashboard the sidebar is the navigation, and seventeen public categories across the
     top are just noise over it. The one thing an owner cannot otherwise do from here is get back
     out to the public site, so that is what takes the space instead. */
  if (pathname.startsWith("/account") || pathname.startsWith("/onboarding")) {
    return (
      <div className="flex min-w-0 flex-1 items-center lg:order-1">
        <Link
          href="/"
          className="group flex items-center gap-2 rounded-full bg-brand-50/60 px-4 py-2.5 text-sm font-bold text-brand-800 transition-colors duration-200 ease-out hover:bg-brand-100 hover:text-brand-700 motion-reduce:transition-none"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-x-0.5 motion-reduce:transition-none">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Go to home
        </Link>
      </div>
    );
  }

  const onNavBar = tree.slice(0, NAV_SLOTS);

  return (
    <>
      {/* Wide screens: one row of disclosure buttons with a mega-menu panel under the header. */}
      <nav
        aria-label="Business categories"
        ref={navRef}
        className="relative hidden min-w-0 flex-1 items-center justify-center gap-x-2.5 gap-y-1 lg:order-1 lg:flex xl:gap-x-3 2xl:gap-x-4"
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            close(open.slug);
          }
        }}
        onBlur={(event) => {
          // Keep the panel open while focus is still somewhere inside the nav.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
        }}
      >
        {/*
          Each panel is rendered immediately after its own button, inside the same wrapper. Two
          things depend on that: Tab from the button lands on the first link inside the panel, and
          the pointer can travel from button to panel without ever leaving the wrapper, so
          onMouseLeave does not fire on the way. The panel is positioned against the <nav>, which is
          the nearest positioned ancestor, so it still spans the width of the header.
        */}
        {onNavBar.map((parent, index) => {
          const isOpen = open?.slug === parent.slug;
          const panelId = `category-panel-${parent.slug}`;
          return (
            <div
              key={parent.slug}
              className={`${SLOT_CLASS[index]} ${SLOT_PADDING}`}
              onMouseEnter={() => hoverOpen(parent.slug)}
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                ref={(element) => {
                  buttonRefs.current.set(parent.slug, element);
                }}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onFocus={() => setOpen((current) => (current && current.slug !== parent.slug ? null : current))}
                onClick={() => toggle(parent.slug)}
                className={TRIGGER_CLASS}
              >
                {/* Short on the bar; the full name is there for anyone who cannot see the row it
                    has to fit into. */}
                <span aria-hidden="true">{navLabel(parent)}</span>
                <span className="sr-only">{parent.name}</span>
                <Chevron open={isOpen} />
              </button>

              {isOpen ? (
                <div id={panelId} className={PANEL_CLASS}>
                  <Link
                    href={`/${parent.slug}`}
                    className="text-xs font-black tracking-[0.18em] text-brand-700 uppercase hover:underline"
                  >
                    All {parent.name} &rarr;
                  </Link>
                  <ul className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-3 xl:grid-cols-4">
                    {parent.children.map((child) => (
                      <li key={child.slug}>
                        <Link href={`/${parent.slug}/${child.slug}`} className={PANEL_LINK_CLASS}>
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })}

        {/*
          Every parent category, always. This is what makes hiding the later shortcuts above safe:
          whatever the viewport, all seventeen are one click away.
        */}
        <div onMouseEnter={() => hoverOpen(ALL)} onMouseLeave={scheduleClose}>
          <button
            type="button"
            ref={(element) => {
              buttonRefs.current.set(ALL, element);
            }}
            aria-expanded={open?.slug === ALL}
            aria-controls="category-panel-all"
            onFocus={() => setOpen((current) => (current && current.slug !== ALL ? null : current))}
            onClick={() => toggle(ALL)}
            className={TRIGGER_CLASS}
          >
            All categories
            <Chevron open={open?.slug === ALL} />
          </button>

          {open?.slug === ALL ? (
            <div id="category-panel-all" className={PANEL_CLASS}>
              <p className="text-xs font-black tracking-[0.18em] text-brand-700 uppercase">Browse every category</p>
              <ul className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-3 xl:grid-cols-4">
                {tree.map((parent) => (
                  <li key={parent.slug}>
                    <Link href={`/${parent.slug}`} className={PANEL_LINK_CLASS}>
                      {parent.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </nav>

      {/* Narrow screens: the same tree, stacked. Tap to open; hover plays no part here. */}
      <button
        type="button"
        aria-expanded={mobileOpen}
        aria-controls="category-nav-mobile"
        onClick={() => setMobileOpen((isOpen) => !isOpen)}
        className="order-3 cursor-pointer px-1 text-2xl text-brand-700 lg:hidden"
      >
        <span className="sr-only">Browse categories</span>
        <span aria-hidden="true">&#9776;</span>
      </button>

      {mobileOpen ? (
        <nav
          id="category-nav-mobile"
          aria-label="Business categories"
          className="absolute top-full right-0 left-0 z-30 max-h-[70vh] overflow-y-auto border-t border-line bg-white px-5 pb-5 shadow-[0_10px_18px_#002a3418] lg:hidden"
        >
          {tree.map((parent) => {
            const isOpen = open?.slug === parent.slug;
            const panelId = `category-mobile-${parent.slug}`;
            return (
              <div key={parent.slug} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(parent.slug)}
                  className="flex w-full cursor-pointer items-center justify-between py-3.5 text-left text-[15px] font-bold text-brand-800"
                >
                  {parent.name}
                  <span aria-hidden="true" className="text-brand-700">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                {isOpen ? (
                  <ul id={panelId} className="pb-3">
                    <li>
                      <Link
                        href={`/${parent.slug}`}
                        className="block py-2 pl-3 text-sm font-black text-brand-700"
                      >
                        All {parent.name} &rarr;
                      </Link>
                    </li>
                    {parent.children.map((child) => (
                      <li key={child.slug}>
                        <Link href={`/${parent.slug}/${child.slug}`} className="block py-2 pl-3 text-sm text-ink">
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}
