import { signOutAction } from "@/app/listings/actions";
import { StaffSidebar, type NavItem } from "@/components/StaffSidebar";
import { getAdminProfile } from "@/lib/admin-api";

/**
 * The frame around every signed-in admin screen.
 *
 * A sidebar rather than a bar across the top, which is how the original's admin was laid out: by
 * the time there were eight queues the top bar had run out of room and started wrapping, and a
 * vertical list has no such limit.
 */
const ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", mark: "▦" },
  { href: "/listings", label: "Listings", mark: "☰" },
  { href: "/reviews", label: "Reviews", mark: "★" },
  { href: "/reports", label: "Reports", mark: "⚠" },
  { href: "/blog", label: "Blog", mark: "✎" },
  { href: "/seo", label: "SEO", mark: "⌕" },
  { href: "/search", label: "Search", mark: "⌘" },
  { href: "/categories", label: "Categories", mark: "⊞" },
  { href: "/locations", label: "Locations", mark: "⚑" },
  { href: "/homepage/popular-categories", label: "Popular categories", mark: "◉" },
  { href: "/homepage/scrolling-text", label: "Scrolling text", mark: "⇄" },
];

export async function AdminChrome({ children }: { children: React.ReactNode }) {
  const me = await getAdminProfile();

  return (
    <div className="lg:flex">
      <StaffSidebar
        title="HL ADMIN"
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
