import Link from "next/link";
import { signOutAction } from "@/app/listings/actions";
import { getAdminProfile } from "@/lib/admin-api";

/**
 * The bar across the top of every signed-in admin screen: where you are, who you are, and the way
 * out. It lives here rather than in one route's layout so the listings and reviews queues cannot
 * drift apart.
 *
 * The links are shown to everyone signed in. The API refuses a queue the account has no permission
 * for, and that refusal is what the page then explains — hiding a link is not authorisation.
 */
export async function AdminChrome({ children }: { children: React.ReactNode }) {
  const me = await getAdminProfile();

  return (
    <>
      <div className="border-b border-neutral-200 bg-brand-50">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
          <div className="flex items-center gap-4">
            <Link href="/listings" className="font-semibold text-brand-900">
              Listings
            </Link>
            <Link href="/reviews" className="font-semibold text-brand-900">
              Reviews
            </Link>
            <Link href="/reports" className="font-semibold text-brand-900">
              Reports
            </Link>
            <Link href="/blog" className="font-semibold text-brand-900">
              Blog
            </Link>
            <Link href="/seo" className="font-semibold text-brand-900">
              SEO
            </Link>
            <Link href="/search" className="font-semibold text-brand-900">
              Search
            </Link>
            <Link href="/categories" className="font-semibold text-brand-900">
              Categories
            </Link>
            <Link href="/locations" className="font-semibold text-brand-900">
              Locations
            </Link>
            <span className="text-neutral-700">
              {me.ok ? `${me.data.displayName} (${me.data.roles.join(", ") || "no role"})` : "Signed in"}
            </span>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="font-medium text-brand-700 underline-offset-2 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
      {children}
    </>
  );
}
