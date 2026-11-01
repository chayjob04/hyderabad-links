import { signOutAction } from "@/app/actions";
import { StaffSidebar, type NavItem } from "@/components/StaffSidebar";
import { getProfile } from "@/lib/super-admin-api";

/**
 * The frame around every signed-in super-admin screen: the same sidebar as the admin site, in the
 * same place, so somebody who works in both does not have to relearn where things are.
 *
 * A session here already means the account holds `admins.manage`. The API checks the permission
 * again on every request regardless — hiding a link is never the control.
 */
const ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview", mark: "▦" },
  { href: "/listings", label: "Listings", mark: "☰" },
  { href: "/listings/by-category", label: "By category", mark: "⊞" },
  { href: "/listings/by-subcategory", label: "By subcategory", mark: "⊟" },
  { href: "/accounts", label: "Business accounts", mark: "☻" },
  { href: "/featured", label: "Featured", mark: "★" },
  { href: "/admins", label: "Admin accounts", mark: "☺" },
  { href: "/audit", label: "Audit log", mark: "⌗" },
];

export async function SuperAdminChrome({ children }: { children: React.ReactNode }) {
  const me = await getProfile();

  return (
    <div className="lg:flex">
      <StaffSidebar
        title="HL SUPER ADMIN"
        items={ITEMS}
        footer={
          <>
            <p className="font-bold text-white">{me.ok ? me.data.displayName : "Signed in"}</p>
            {me.ok ? (
              <p className="mt-0.5 text-xs">{me.data.roles.join(", ") || "no role"}</p>
            ) : null}
            <form action={signOutAction} className="mt-3">
              <button
                type="submit"
                className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-bold text-white hover:bg-white/10"
              >
                Sign out
              </button>
            </form>
          </>
        }
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
