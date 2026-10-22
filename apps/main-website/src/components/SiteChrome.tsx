import Image from "next/image";
import Link from "next/link";
import { CategoryNav } from "@/components/CategoryNav";
import { getCategories } from "@/lib/api";
import { BRAND_NAME } from "@/lib/brand";

export async function SiteHeader() {
  const tree = await getCategories();

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

        <a
          href="https://hyderabadlinks.com/blog"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-bold hover:opacity-70"
        >
          Blog
        </a>

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
  className="h-12 w-auto max-w-[240px] object-contain sm:h-16 sm:max-w-[360px]"
/>
        </Link>

        {/* Existing category navigation */}
        <div className="hidden min-w-0 flex-1 justify-center md:flex">
          <CategoryNav tree={tree} />
        </div>

        {/* Login */}
        <Link
          href="/login"
          className="shrink-0 bg-brand-700 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-brand-800 sm:px-6 sm:py-3"
        >
          LogIn
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-[#333] text-neutral-300">
      <div className="relative flex min-h-[115px] flex-col items-center justify-around gap-5 bg-brand-700 px-5 py-7 text-white sm:flex-row sm:gap-6">
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-bold">
          <Link href="/" className="hover:opacity-70">
            Home
          </Link>

          <Link href="/search" className="hover:opacity-70">
            Search
          </Link>

          <Link href="/account/listings" className="hover:opacity-70">
            List your business
          </Link>

          <Link href="/login" className="hover:opacity-70">
            Owner sign in
          </Link>

          <a
            href="https://hyderabadlinks.com/blog"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-70"
          >
            Blog
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
