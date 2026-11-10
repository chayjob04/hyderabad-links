import type { Metadata } from "next";
import { CustomerDrawerNav, CustomerSidebarNav } from "@/components/my/CustomerNav";
import { getCustomer } from "@/lib/customer-api";
import { signOutCustomerAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The customer's account, at /my. Its own shell, its own session, its own API client — the business
 * owner's dashboard at /account shares none of it.
 *
 * `getCustomer()` is the gate: anyone without a usable customer token is sent to sign in again, on
 * the server, before any page inside renders. An owner token will not do, because the API refuses
 * the `customer` audience to anything else and the other way round.
 */
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const me = await getCustomer();

  const signOutButton = (
    <form action={signOutCustomerAction}>
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
        <CustomerDrawerNav>{signOutButton}</CustomerDrawerNav>
      </div>

      <div className="mt-4 gap-10 lg:mt-0 lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside aria-label="Your account" className="hidden lg:block">
          <div className="sticky top-[136px] rounded-2xl border border-line bg-white p-4 shadow-[0_8px_22px_#002a340b]">
            <p className="px-3 pt-1 pb-3 text-xs font-black tracking-[0.12em] text-muted uppercase">
              Your account
            </p>
            <CustomerSidebarNav />
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
