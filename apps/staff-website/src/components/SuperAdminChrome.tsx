import { signOutAction } from "@/app/super-admin/actions";
import { MiniaShell } from "@/components/minia/MiniaShell";
import { MiniaStyles } from "@/components/minia/MiniaStyles";
import { SUPER_ADMIN_NAV, visibleNav } from "@/components/minia/nav";
import { getProfile } from "@/lib/super-admin-api";

/**
 * The frame around every signed-in super-admin screen.
 *
 * It is the original application's Super Admin layout — Minia 2.4.0, the same markup and the same
 * stylesheets — rebuilt as React. The menu it shows comes from `SUPER_ADMIN_NAV`, transcribed row
 * for row from `Views/Super/Shared/_SuperLayout.cshtml`.
 *
 * A session here already means the account holds `admins.manage`. The permissions read below only
 * decide which rows are worth showing; the API checks every one of them again on every request,
 * because hiding a link is never the control.
 */
export async function SuperAdminChrome({ children }: { children: React.ReactNode }) {
  const me = await getProfile();
  const permissions = me.ok ? me.data.permissions : [];

  return (
    <>
      <MiniaStyles />
      <MiniaShell
        homeHref="/super-admin/overview"
        nav={visibleNav(SUPER_ADMIN_NAV, permissions)}
        displayName={me.ok ? me.data.displayName : "Signed in"}
        subtitle={me.ok ? me.data.email : undefined}
        profileHref="/super-admin/password"
        signOut={signOutAction}
        surfaceLabel="Super Admin"
        environment={process.env.APP_ENV ?? "LOCAL"}
      >
        {children}
      </MiniaShell>
    </>
  );
}
