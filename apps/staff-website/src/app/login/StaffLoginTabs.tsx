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
 *
 * The original had no tabs — it had two separate login pages. `nav-pills nav-justified` is the
 * theme's own way of saying "one of these two", and it is what lets both of those pages become one.
 */
const TABS: { id: StaffTab; label: string }[] = [
  { id: "admin", label: "Admin" },
  { id: "super", label: "Super Admin" },
];

export function StaffLoginTabs({ active }: { active: StaffTab }) {
  return (
    <ul role="tablist" aria-label="Choose a staff sign-in" className="nav nav-pills nav-justified mb-4">
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <li key={tab.id} className="nav-item">
            <Link
              href={`/login?tab=${tab.id}`}
              role="tab"
              aria-selected={selected}
              className={`nav-link${selected ? " active" : ""}`}
            >
              {tab.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
