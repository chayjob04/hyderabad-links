import Image from "next/image";
import Link from "next/link";
import { CategoryNav } from "@/components/CategoryNav";
import { getCategories } from "@/lib/api";
import { BRAND_NAME } from "@/lib/brand";

/** The site's wordmark. There is no logo file yet, so the name is drawn in type. */
function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-black tracking-tight text-brand-800 ${className}`}>
      Hyderabad <b className="text-brand-500">Links</b>
    </span>
  );
}

/**
 * The teal utility bar and the white main navigation, as in the reference build.
 *
 * Only links to pages that exist are shown. The reference also carries About, Membership, Contact,
 * Terms and Privacy; those routes are not built here yet, and a header full of 404s would be worse
 * than a shorter one.
 *
 * The category tree is fetched here, on the server, and handed to the client nav component.
 */
export async function SiteHeader() {
  const tree = await getCategories();

  return (
    <header className="sticky top-0 z-40 bg-white shadow-[0_3px_18px_#002a3410]">
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
        <Link href="/account/listings" className="hidden text-sm font-bold hover:opacity-70 sm:block">
          List your business
        </Link>
      </div>

      <div className="relative mx-auto flex min-h-[68px] max-w-[1600px] items-center justify-between gap-4 px-5 lg:min-h-[76px] lg:px-10">
       <Link
  href="/"
  aria-label="Hyderabad Links home"
  className="order-1 flex shrink-0 items-center"
>
  <Image
    src="/hyderabad-links-logo.png"
    alt="Hyderabad Links"
    width={220}
    height={80}
    priority
    className="h-12 w-auto object-contain sm:h-14"
  />
</Link>

        <CategoryNav tree={tree} />

        <Link
          href="/login"
          className="order-2 ml-auto shrink-0 bg-brand-700 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-brand-800 xl:ml-0 xl:px-6 xl:py-3"
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

      <div className="px-5 pt-8 pb-6 text-center">
        <BrandMark className="text-lg text-white" />
        <p className="mt-2.5 text-sm text-neutral-400">
          &copy; {new Date().getFullYear()} {BRAND_NAME}. All rights reserved.
        </p>
        <small className="text-neutral-500">Hyderabad&apos;s local business directory.</small>
      </div>
    </footer>
  );
}
