import type { Metadata } from "next";
import { AccountDrawerNav, AccountSidebarNav } from "@/components/account/AccountNav";
import { getMe } from "@/lib/owner-api";
import { signOutAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The authenticated shell every owner page sits inside: a sidebar on a wide screen, a drawer on a
 * narrow one, and a bar showing who is signed in.
 *
 * `getMe()` is the gate: anyone without a usable token is sent to sign in again, on the server,
 * before any page inside renders — hiding links would not be a control.
 *
 * This is the *business* account. A customer has their own, at /my, with its own session and its
 * own token audience — a customer token is refused by every route under /api/v1/me, so nobody
 * arrives here by holding the wrong cookie.
 *
 * The business-registration gate is not on this shell. It lives on the pages that need a business,
 * which is `account/listings/layout.tsx` and the dashboard below it, so correcting your name or
 * email does not require finishing onboarding first.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();

  const signOutButton = (
    <form action={signOutAction}>
      <button
        type="submit"
        className="w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm font-bold text-brand-700 hover:bg-brand-50 lg:text-center"
      >
        Logout
      </button>
    </form>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
      {/* Narrow screens: the nav collapses into a drawer above the content. */}
      <div className="lg:hidden">
        <AccountDrawerNav>{signOutButton}</AccountDrawerNav>
      </div>

      <div className="mt-4 gap-10 lg:mt-0 lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside aria-label="Dashboard" className="hidden lg:block">
          <div className="sticky top-[136px] rounded-2xl border border-line bg-white p-4 shadow-[0_8px_22px_#002a340b]">
            {/* Not "Business owner" any more: this shell is also where someone who only saves
                favourites now lands, and labelling their account as a business would be wrong. */}
            <p className="px-3 pt-1 pb-3 text-xs font-black tracking-[0.12em] text-muted uppercase">
              Your account
            </p>
            <AccountSidebarNav />
            <div className="mt-2 border-t border-line pt-2">{signOutButton}</div>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
            <p className="text-sm text-muted">
              Signed in as{" "}
              <span className="font-bold text-brand-800">{me.ok ? me.data.phone : "your account"}</span>
            </p>
            {me.ok && me.data.name ? (
              <p className="text-sm font-bold text-brand-800">{me.data.name}</p>
            ) : null}
          </div>
          <div className="pt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
