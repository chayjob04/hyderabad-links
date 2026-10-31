import Image from "next/image";
import Link from "next/link";
import { signOutAction } from "@/app/account/actions";
import { CategoryNav } from "@/components/CategoryNav";
import { ProfileMenu } from "@/components/ProfileMenu";
import { getCategories } from "@/lib/api";
import { BRAND_NAME, SOCIAL_LINKS, SUPPORT_EMAIL } from "@/lib/brand";
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

        <Link href="/search" className="text-sm font-bold hover:opacity-70">
          Search
        </Link>

        {/* Was an outbound link to the old site, which took visitors off this one and gave the
            traffic away. The blog now lives here. */}
        <Link href="/pricing" className="hidden text-sm font-bold hover:opacity-70 sm:block">
          Pricing
        </Link>
        <Link href="/blog" className="text-sm font-bold hover:opacity-70">
          Blog
        </Link>

        <Link
          href="/account/listings"
          className="hidden text-sm font-bold hover:opacity-70 sm:block"
        >
          List your business
        </Link>
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
      {/* The navigation that used to live here repeated the header exactly, which is the one place
          a footer earns nothing. It carries the things a header has no room for instead: where to
          find us, and the terms people are agreeing to. */}
      <div className="relative flex min-h-[115px] flex-col items-center justify-center gap-4 bg-brand-700 px-5 py-7 text-white">
        {SOCIAL_LINKS.length > 0 ? (
          <nav aria-label="Follow us" className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-bold">
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

        <nav aria-label="Legal and help" className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-bold">
          <Link href="/terms" className="hover:opacity-70">
            Terms of use
          </Link>

          <Link href="/privacy" className="hover:opacity-70">
            Privacy policy
          </Link>

          <Link href="/about" className="hover:opacity-70">
            About
          </Link>
          <Link href="/pricing" className="hover:opacity-70">
            Pricing
          </Link>
          <Link href="/blog" className="hover:opacity-70">
            Blog
          </Link>
          <Link href="/help" className="hover:opacity-70">
            Help &amp; feedback
          </Link>

          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:opacity-70">
            Contact us
          </a>
        </nav>
      </div>

      <div className="px-5 pb-6 pt-8 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2"
          aria-label="Hyderabad Links home"
        >
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

        <small className="text-neutral-500">
          Hyderabad&apos;s local business directory.
        </small>
      </div>
    </footer>
  );
}

