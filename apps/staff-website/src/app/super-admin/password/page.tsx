import type { Metadata } from "next";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
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
      <main className="mx-auto max-w-xl px-4 pt-8 pb-12">
        <h1 className="text-2xl font-bold text-neutral-900">Change my password</h1>
        <p className="mt-1 text-neutral-600">
          {me.ok ? me.data.email : "Your account"}
        </p>

        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          {state.ok ? (
            <PasswordForm mustChange={state.data.mustChangePassword} />
          ) : (
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {state.message}
            </p>
          )}
        </div>
      </main>
    </SuperAdminChrome>
  );
}
