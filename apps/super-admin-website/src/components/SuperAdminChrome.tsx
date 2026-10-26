import Link from "next/link";
import { signOutAction } from "@/app/actions";
import { getProfile } from "@/lib/super-admin-api";

/**
 * The bar across the top of every signed-in page: where you are, who you are, and the way out.
 *
 * The links are shown to anyone with a session here, and a session here already means the account
 * holds `admins.manage`. The API checks the permission again on every request regardless — hiding a
 * link is never the control.
 */
export async function SuperAdminChrome({ children }: { children: React.ReactNode }) {
  const me = await getProfile();

  return (
    <>
      <div className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
          <div className="flex items-center gap-4">
            <Link href="/overview" className="font-semibold text-neutral-900">
              Overview
            </Link>
            <Link href="/listings" className="font-semibold text-neutral-900">
              Listings
            </Link>
            <Link href="/featured" className="font-semibold text-neutral-900">
              Featured
            </Link>
            <Link href="/admins" className="font-semibold text-neutral-900">
              Admin accounts
            </Link>
            <Link href="/audit" className="font-semibold text-neutral-900">
              Audit log
            </Link>
            <span className="text-neutral-700">
              {me.ok ? `${me.data.displayName} (${me.data.roles.join(", ") || "no role"})` : "Signed in"}
            </span>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="font-medium text-red-700 underline-offset-2 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
      {children}
    </>
  );
}
