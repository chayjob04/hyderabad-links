import { signOutAction } from "@/app/admin/listings/actions";
import { MiniaShell } from "@/components/minia/MiniaShell";
import { MiniaStyles } from "@/components/minia/MiniaStyles";
import { ADMIN_NAV, visibleNav } from "@/components/minia/nav";
import { getAdminProfile } from "@/lib/admin-api";

/**
 * The frame around every signed-in admin screen.
 *
 * It is the original application's Admin layout — Minia 2.4.0, the same markup and the same
 * stylesheets — rebuilt as React. The menu comes from `ADMIN_NAV`, transcribed row for row from
 * `Views/Admin/Shared/_AdminLayout.cshtml`.
 *
 * The original decided what to show from a numeric RoleID. We read the account's real permissions
 * instead, so nothing here invents a role the authorization model does not have. The API re-checks
 * each permission on every request regardless.
 */
export async function AdminChrome({ children }: { children: React.ReactNode }) {
  const me = await getAdminProfile();
  const permissions = me.ok ? me.data.permissions : [];

  return (
    <>
      <MiniaStyles />
      <MiniaShell
        homeHref="/admin"
        nav={visibleNav(ADMIN_NAV, permissions)}
        displayName={me.ok ? me.data.displayName : "Signed in"}
        subtitle={me.ok ? me.data.email : undefined}
        profileHref="/admin/password"
        signOut={signOutAction}
        surfaceLabel="Admin"
        environment={process.env.APP_ENV ?? "LOCAL"}
      >
        {children}
      </MiniaShell>
    </>
  );
}
