import Link from "next/link";

/**
 * Which of the two public sign-in tabs is showing.
 *
 * Both tabs run the *same* authentication — one mobile number, one OTP, one account — because that
 * is what the API has always done: verifying a code upserts a row in `users` and creates a session,
 * whether or not that person owns a business. Ownership is a `business_members` row, decided after
 * sign-in, not a second kind of login.
 *
 * So the tab is not an account type. It is what the person came here to do, and it decides two
 * things: the words on the form, and where they land afterwards. A first-time number on the
 * business tab goes to /onboarding to register a business; on the user tab it goes straight to the
 * account, because a visitor saving a favourite should never be asked to name a business.
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
