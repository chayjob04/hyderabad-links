import Image from "next/image";
import Link from "next/link";
import { signOutAction } from "@/app/account/actions";
import { CategoryNav } from "@/components/CategoryNav";
import { ProfileMenu } from "@/components/ProfileMenu";
import { getCategories } from "@/lib/api";
import { BRAND_NAME, POWERED_BY, SOCIAL_LINKS, SUPPORT_EMAIL, WHATSAPP_CONTACT } from "@/lib/brand";
import { getMeIfSignedIn } from "@/lib/owner-api";

export async function SiteHeader() {
  // Both in one round trip. getMeIfSignedIn answers rather than redirects, so a logged-out visitor
  // on a public page is not bounced to the login screen by the header.
  const [tree, me] = await Promise.all([getCategories(), getMeIfSignedIn()]);

  return (
    <header className="sticky top-0 z-40 bg-white shadow-[0_3px_18px_#002a3410]">
      {/* Top navigation */}
      <div className="flex h-[50px] items-center justify-center gap-6 bg-brand-700 px-4 text-white sm:gap-10 lg:gap-14">
        <Link href="/" className="text-sm font-bold hover:opacity-70">
          Home
        </Link>

        <Link href="/about" className="text-sm font-bold hover:opacity-70">
          About
        </Link>

        {/* "Membership" rather than "Pricing": it is what the original called it, and what the
            page is really selling is being listed as a member, not a price. */}
        <Link href="/pricing" className="text-sm font-bold hover:opacity-70">
          Membership
        </Link>

        <Link href="/blog" className="text-sm font-bold hover:opacity-70">
          Blog
        </Link>

        {/* A WhatsApp link, as on the original: on a phone it opens the conversation itself. */}
        <a
          href={WHATSAPP_CONTACT}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-bold hover:opacity-70"
        >
          Contact
        </a>
      </div>

      {/* Main header */}
      <div className="mx-auto flex min-h-[68px] max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:min-h-[76px] lg:px-10">
        {/* Logo and company name */}
        <Link
          href="/"
          aria-label="Hyderabad Links home"
          className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3"
        >
          <Image
            src="/hyderabad-links-logo.png"
            alt="Hyderabad Links emblem"
            width={64}
            height={64}
            priority
            className="h-10 w-10 shrink-0 object-contain sm:h-14 sm:w-14"
          />

          <Image
  src="/hyderabad-links-name.png"
  alt="Hyderabad Links"
  width={400}
  height={100}
  priority
  className="h-12 w-auto max-w-[60px] object-contain sm:h-16 sm:max-w-[140px]"
/>
        </Link>

        {/* Existing category navigation */}
        <div className="hidden min-w-0 flex-1 justify-center md:flex">
          <CategoryNav tree={tree} />
        </div>

        {/* Signed in: the account menu. Signed out: the way in. Same spot either way, on every
            page including the dashboard, so there is never a Login button while you are logged in. */}
        {me ? (
          <ProfileMenu
            name={me.name}
            phone={me.phone}
            signOut={
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm font-bold text-red-700 hover:bg-red-50"
                >
                  Logout
                </button>
              </form>
            }
          />
        ) : (
          <Link
            href="/login"
            className="shrink-0 bg-brand-700 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-brand-800 sm:px-6 sm:py-3"
          >
            LogIn
          </Link>
        )}
      </div>
    </header>
  );
}


export function SiteFooter() {
  return (
    <footer className="bg-[#333] text-neutral-300">
      {/* Four bands across, as on the original: the two documents people actually look for, the
          social accounts, and the same five links as the top bar. The header's navigation is
          repeated here on purpose — at the bottom of a long listing page it is the nearest way
          out, and that is the one place repeating it earns its space. */}
      <div className="bg-brand-700 px-5 py-9 text-white">
        <div className="mx-auto grid max-w-[1200px] gap-8 text-center sm:grid-cols-2 lg:grid-cols-4 lg:text-left">
          <div>
            <h2 className="text-xs font-black tracking-[0.18em] opacity-70">DOCUMENTS</h2>
            <ul className="mt-3 space-y-2 text-sm font-bold">
              <li>
                <Link href="/terms" className="hover:opacity-70">
                  Terms of use
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:opacity-70">
                  Privacy policy
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-black tracking-[0.18em] opacity-70">BROWSE</h2>
            <ul className="mt-3 space-y-2 text-sm font-bold">
              <li>
                <Link href="/categories" className="hover:opacity-70">
                  All categories
                </Link>
              </li>
              <li>
                <Link href="/areas" className="hover:opacity-70">
                  All areas
                </Link>
              </li>
              <li>
                <Link href="/trending" className="hover:opacity-70">
                  Trending
                </Link>
              </li>
              <li>
                <Link href="/verified" className="hover:opacity-70">
                  Verified businesses
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-black tracking-[0.18em] opacity-70">HYDERABAD LINKS</h2>
            <ul className="mt-3 space-y-2 text-sm font-bold">
              <li>
                <Link href="/" className="hover:opacity-70">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:opacity-70">
                  About
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:opacity-70">
                  Membership
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:opacity-70">
                  Blog
                </Link>
              </li>
              <li>
                <a
                  href={WHATSAPP_CONTACT}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:opacity-70"
                >
                  Contact
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-black tracking-[0.18em] opacity-70">FOLLOW US</h2>
            {SOCIAL_LINKS.length > 0 ? (
              <nav
                aria-label="Follow us"
                className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-bold lg:justify-start"
              >
                {SOCIAL_LINKS.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:opacity-70"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            ) : null}

            <p className="mt-4 text-sm">
              <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold hover:opacity-70">
                {SUPPORT_EMAIL}
              </a>
            </p>
            <p className="mt-1 text-sm">
              <Link href="/help" className="font-bold hover:opacity-70">
                Help &amp; feedback
              </Link>
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 pt-8 pb-6 text-center">
        <Link href="/" className="inline-flex items-center gap-2" aria-label="Hyderabad Links home">
          <Image
            src="/hyderabad-links-logo.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-contain"
          />
          <span className="font-bold text-white">{BRAND_NAME}</span>
        </Link>

        <p className="mt-2.5 text-sm text-neutral-400">
          &copy; {new Date().getFullYear()} {BRAND_NAME}. All rights reserved.
        </p>

        <small className="text-neutral-500">{POWERED_BY}</small>
      </div>
    </footer>
  );
}
