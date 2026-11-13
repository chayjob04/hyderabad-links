"use client";

import { useEffect, useRef, useState } from "react";
import type { MiniaNavItem } from "./nav";
import { SidebarMenu } from "./SidebarMenu";
import "./minia-shell.css";

/**
 * The frame both panels sit in, converted from the original Razor layouts.
 *
 * The markup is the original's, element for element and class for class: `#layout-wrapper`,
 * `#page-topbar` with its `.navbar-header`, `.navbar-brand-box`, the fixed `.vertical-menu`
 * sidebar, `.main-content > .page-content > .container-fluid`, and the footer. app.min.css styles
 * all of it, so the appearance is the theme's rather than anything written here.
 *
 * What is *not* the original's is the JavaScript. The two layouts loaded jQuery, metisMenu,
 * simplebar, Bootstrap's bundle, feather-icons and app.js — six libraries that work by mutating
 * the DOM, which is precisely what React cannot share. Every behaviour they provided is state, and
 * is held here instead:
 *
 *   sidebar collapse   the original toggled `sidebar-enable` and `vertical-collpsed` on <body>
 *                      (the misspelling is the theme's, and the CSS depends on it)
 *   accordion          SidebarMenu
 *   topbar dropdown    UserDropdown, below
 *   custom scrollbar   the browser's own; simplebar is cosmetic and costs a hydration boundary
 *   feather icons      the one icon the topbar used is inline SVG
 *
 * No jQuery, no `document.querySelector`, nothing written during render — so there is nothing to
 * mismatch between the server's HTML and the client's first paint.
 */

export type MiniaShellProps = {
  /** Where the logo links to, and which menu is shown. */
  homeHref: string;
  nav: MiniaNavItem[];
  displayName: string;
  /** Shown under the name in the topbar dropdown. */
  subtitle?: string;
  profileHref: string;
  signOut: () => Promise<void>;
  /** "ADMIN" or "SUPER ADMIN", with the environment beside it. */
  surfaceLabel: string;
  environment: string;
  children: React.ReactNode;
};

export function MiniaShell({
  homeHref,
  nav,
  displayName,
  subtitle,
  profileHref,
  signOut,
  surfaceLabel,
  environment,
  children,
}: MiniaShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  /*
   * The theme reads these two classes off <body>, so they have to be set there rather than on a
   * wrapper. Doing it in an effect keeps the server's HTML and the client's first render identical
   * — the classes appear after hydration, which is also when they can first mean anything.
   *
   * The rule is the original's, verbatim: on a wide screen the button collapses the sidebar to its
   * icon rail; on a narrow one it slides the sidebar in over the page and never collapses it.
   */
  useEffect(() => {
    const { body } = document;
    const wide = window.matchMedia("(min-width: 992px)").matches;
    body.classList.toggle("sidebar-enable", menuOpen);
    body.classList.toggle("vertical-collpsed", wide && menuOpen);
    return () => {
      body.classList.remove("sidebar-enable", "vertical-collpsed");
    };
  }, [menuOpen]);

  return (
    <div id="layout-wrapper">
      <header id="page-topbar">
        <div className="navbar-header">
          <div className="d-flex">
            <div className="navbar-brand-box">
              <a href={homeHref} className="logo logo-dark">
                <span className="logo-sm">
                  <img src="/assets/admin/images/logo.png" alt="" height={24} />
                </span>
                <span className="logo-lg">
                  <img src="/assets/admin/images/logo.png" alt="" height={24} />
                  <span className="logo-txt">Hyderabad Links</span>
                </span>
              </a>
              <a href={homeHref} className="logo logo-light">
                <span className="logo-sm">
                  <img src="/assets/admin/images/logo.png" alt="" height={24} />
                </span>
                <span className="logo-lg">
                  <img src="/assets/admin/images/logo.png" alt="" height={24} />
                  <span className="logo-txt">Hyderabad Links</span>
                </span>
              </a>
            </div>

            <button
              type="button"
              className="btn btn-sm px-3 font-size-16 header-item"
              id="vertical-menu-btn"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <i className="fa fa-fw fa-bars" />
            </button>
          </div>

          <div className="d-flex align-items-center">
            {/*
             * Which surface, and which environment. The original had no such band — it was one
             * application against one database — but this build runs against staging and
             * production from the same artifact, and somebody holding both roles needs to know
             * which powers the page carries. Kept, moved into the topbar: the original's band sat
             * above a header that is `position: fixed`, so it had nowhere to go.
             */}
            <span className="d-none d-md-inline-flex align-items-center me-2">
              <span className="badge bg-dark-subtle text-body font-size-11 fw-semibold text-uppercase">
                {surfaceLabel}
              </span>
              <span className="badge bg-light text-muted font-size-11 fw-semibold text-uppercase ms-1">
                {environment}
              </span>
            </span>

            <UserDropdown
              displayName={displayName}
              subtitle={subtitle}
              profileHref={profileHref}
              signOut={signOut}
            />
          </div>
        </div>
      </header>

      <div className="vertical-menu">
        <div className="h-100" style={{ overflowY: "auto" }}>
          <SidebarMenu items={nav} />

          {/* Logout closes both of the original's menus. There it was a GET; here it posts the
              existing server action, so the row lives in a form of its own. */}
          <div id="sidebar-menu">
            <ul className="metismenu list-unstyled">
              <li className="menu-title mt-2">&nbsp;</li>
              <li>
                <form action={signOut} className="minia-signout-form">
                  <button type="submit" className="minia-nav-btn">
                    <i className="fas fa-sign-out-alt" />
                    <span>Logout</span>
                  </button>
                </form>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="page-content">
          <div className="container-fluid">{children}</div>
        </div>

        <footer className="footer">
          <div className="container-fluid">
            <div className="row">
              <div className="col-sm-6">
                {/* The original wrote the year with document.write, which would differ between the
                    server's render and the client's. Rendered on the server only. */}
                {new Date().getFullYear()} © Hyderabad Links.com
              </div>
              <div className="col-sm-6">
                <div className="text-sm-end d-none d-sm-block" />
              </div>
            </div>
          </div>
        </footer>
      </div>

      <div className="rightbar-overlay" />
    </div>
  );
}

/**
 * The account menu in the topbar, in place of Bootstrap's dropdown JavaScript.
 *
 * Bootstrap shows a menu by adding `.show` and positioning it with Popper. Both are cheap to do
 * here: the class is state, and the menu is anchored to the button by two CSS rules in
 * minia-shell.css. Everything inside is the theme's own `.dropdown-menu` markup.
 */
function UserDropdown({
  displayName,
  subtitle,
  profileHref,
  signOut,
}: {
  displayName: string;
  subtitle?: string;
  profileHref: string;
  signOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // A menu that stays open after you click elsewhere, or press Escape, is a menu that feels broken.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="dropdown d-inline-block minia-dropdown" ref={root}>
      <button
        type="button"
        className="btn header-item bg-light-subtle border-start border-end"
        id="page-header-user-dropdown"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <img
          className="rounded-circle header-profile-user"
          src="/assets/admin/images/users/avatar-1.jpg"
          alt=""
        />
        <span className="d-none d-xl-inline-block ms-1 fw-medium">{displayName}</span>
        <i className="mdi mdi-chevron-down d-none d-xl-inline-block" />
      </button>

      <div className={`dropdown-menu dropdown-menu-end${open ? " show" : ""}`}>
        {subtitle ? (
          <>
            <h6 className="dropdown-header text-truncate">{subtitle}</h6>
            <div className="dropdown-divider" />
          </>
        ) : null}
        <a className="dropdown-item" href={profileHref}>
          <i className="mdi mdi-key-outline font-size-16 align-middle me-1" /> My password
        </a>
        <div className="dropdown-divider" />
        <form action={signOut}>
          <button type="submit" className="dropdown-item">
            <i className="mdi mdi-logout font-size-16 align-middle me-1" /> Logout
          </button>
        </form>
      </div>
    </div>
  );
}
