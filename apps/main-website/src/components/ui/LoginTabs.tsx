import Link from "next/link";

/**
 * Which of the two public sign-in tabs is showing.
 *
 * The tabs are two *separate* authentications, not two labels on one. Each sends its own OTP, with
 * its own purpose, and opens an account in its own table:
 *
 *     user      -> `customers`, customer_login, the `customer` token audience, hl_cust_* cookies
 *     business  -> `users`,     owner_login,    the `owner` token audience,    hl_* cookies
 *
 * Nothing links them. The same mobile number may hold both, and holding one gives no access to the
 * other — which is the point: signing in to save a shop must never quietly create a business
 * account, as it did while there was one identity behind both tabs.
 *
 * A first-time number on the business tab goes to /onboarding to register a business. On the user
 * tab there is nothing to register, so it goes back to wherever they were.
 */
export type LoginTab = "user" | "business";

export const LOGIN_TABS: { id: LoginTab; label: string }[] = [
  { id: "user", label: "User login" },
  { id: "business", label: "Business login" },
];

/** Reads ?tab=, falling back to whatever the `next` path implies, then to the user tab. */
export function readLoginTab(tab: string | undefined, next: string | undefined): LoginTab {
  if (tab === "business" || tab === "user") return tab;
  // Links that mean business already say so in `next` (the owner CTAs point at /account/listings).
  return next?.startsWith("/account/listings") ? "business" : "user";
}

export function LoginTabs({ active, next }: { active: LoginTab; next?: string }) {
  return (
    <div role="tablist" aria-label="Choose how to sign in" className="grid grid-cols-2 gap-3">
      {LOGIN_TABS.map((tab) => {
        const selected = tab.id === active;
        const query = new URLSearchParams({ tab: tab.id });
        if (next) query.set("next", next);

        return (
          <Link
            key={tab.id}
            href={`/login?${query.toString()}`}
            role="tab"
            aria-selected={selected}
            className={`rounded-xl px-4 py-3 text-center text-base font-extrabold transition ${
              selected
                ? "bg-brand-700 text-white shadow-[0_6px_18px_#002a3426]"
                : "border border-line bg-brand-50 text-brand-800 hover:bg-brand-100"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
