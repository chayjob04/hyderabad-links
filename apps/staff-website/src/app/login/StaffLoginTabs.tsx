import Link from "next/link";
import type { StaffTab } from "./state";

/**
 * The two staff sign-ins, as one row above one form.
 *
 * These are real tabs now, not links to another website. Both surfaces are served from this one
 * deployment, so the sign-in that follows writes its cookie on this origin either way — which is
 * exactly what could not be done while admin and super admin sat on two *.vercel.app hosts, because
 * a cookie cannot cross an origin and `vercel.app` is a public suffix.
 *
 * Switching tab reloads the page, which clears any half-finished sign-in. That is deliberate: an
 * MFA token issued for one surface should not be spent on the other.
 */
const TABS: { id: StaffTab; label: string }[] = [
  { id: "admin", label: "Admin login" },
  { id: "super", label: "Super admin login" },
];

export function StaffLoginTabs({ active }: { active: StaffTab }) {
  return (
    <div role="tablist" aria-label="Choose a staff sign-in" className="grid grid-cols-2 gap-3">
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`/login?tab=${tab.id}`}
            role="tab"
            aria-selected={selected}
            className={`rounded-md px-4 py-3 text-center text-base font-semibold transition ${
              selected
                ? "bg-neutral-700 text-white"
                : "bg-neutral-200 text-neutral-800 hover:bg-neutral-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
