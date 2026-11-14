import type { Metadata } from "next";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import { PageTitle } from "@/components/minia/PageTitle";
import { getPasswordState, getProfile } from "@/lib/super-admin-api";
import { PasswordForm } from "./PasswordForm";

export const metadata: Metadata = { title: "Change my password" };
export const dynamic = "force-dynamic";

/**
 * Your own password, on the super-admin surface.
 *
 * It is reachable while `must_change_password` is set and everything else is refused, because the
 * endpoint behind it requires no permission and so never passes through the gate that does the
 * refusing (S0028). That is deliberate: an account on a temporary password must have exactly one
 * thing it can do.
 */
export default async function SuperAdminPasswordPage() {
  const [state, me] = await Promise.all([getPasswordState(), getProfile()]);

  return (
    <SuperAdminChrome>
      <PageTitle title="My password" breadcrumb={[{ label: "Account" }, { label: "Password" }]} />

      <div className="row g-3">
        <div className="col-xl-5 col-lg-7">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-1">Change my password</h4>
              <p className="card-title-desc mb-3">{me.ok ? me.data.email : "Your account"}</p>

              {state.ok ? (
                <PasswordForm mustChange={state.data.mustChangePassword} />
              ) : (
                <div role="alert" className="alert alert-danger mb-0">
                  {state.message}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </SuperAdminChrome>
  );
}
