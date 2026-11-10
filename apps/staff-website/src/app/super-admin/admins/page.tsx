import type { Metadata } from "next";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import { formatWhen, getProfile, listAdmins, listRoles } from "@/lib/super-admin-api";
import { ResetMfaForm, RolesForm, StatusForm } from "./AccountControls";

export const metadata: Metadata = { title: "Admin accounts" };
export const dynamic = "force-dynamic";

/**
 * The staff accounts, with the two things that can be changed from here: which roles they hold, and
 * whether the account is enabled. Clearing an authenticator is here too, for the person who has lost
 * their phone.
 *
 * Creating an account is **not** here. A new account needs a password delivered to its owner, and no
 * email provider is configured yet, so `create-admin` on the command line remains the only way —
 * which is the honest position rather than a password handed around in a web page.
 */
export default async function AdminAccountsPage() {
  const [accounts, roles, me] = await Promise.all([listAdmins(), listRoles(), getProfile()]);

  // Either list failing makes the page useless, so one message covers both.
  const failure = !accounts.ok ? accounts : !roles.ok ? roles : null;

  return (
    <SuperAdminChrome>
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
        <h1 className="text-2xl font-bold">Admin accounts</h1>
        <p className="mt-1 text-neutral-600">
          Accounts are created with the <code className="font-mono text-sm">create-admin</code> command,
          because a new one needs its password delivered to its owner and no email provider is
          configured yet. Roles, access and authenticators are managed here.
        </p>

        {failure ? (
          <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
            {failure.status === 403 ? "Your account cannot manage administrators." : failure.message}
          </p>
        ) : !accounts.ok || !roles.ok ? null : (
          <ul className="mt-6 space-y-4">
            {accounts.data.map((account) => {
              const isMe = me.ok && me.data.id === account.id;
              return (
                <li key={account.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold">
                        {account.displayName}
                        {isMe ? <span className="ml-2 text-sm font-normal text-neutral-500">(you)</span> : null}
                      </h2>
                      <p className="mt-0.5 text-sm text-neutral-600">{account.email}</p>
                      <p className="mt-1 text-sm text-neutral-600">
                        Added {formatWhen(account.createdAt)} &middot; last signed in{" "}
                        {formatWhen(account.lastSignInAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={
                          account.status === "active"
                            ? "rounded-lg bg-green-50 px-3 py-1 text-sm font-semibold text-green-900"
                            : "rounded-lg bg-red-50 px-3 py-1 text-sm font-semibold text-red-900"
                        }
                      >
                        {account.status}
                      </span>
                      <span className="text-sm text-neutral-600">
                        {account.mfaEnrolled
                          ? `authenticator set up · ${account.unusedRecoveryCodes} recovery codes left`
                          : "no authenticator yet"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-neutral-200 pt-4">
                    <RolesForm adminId={account.id} roles={account.roles} allRoles={roles.data} />
                  </div>

                  <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-neutral-200 pt-4">
                    {isMe ? (
                      // The API refuses both of these for your own account; saying so is clearer
                      // than showing a button that always fails.
                      <p className="text-sm text-neutral-600">
                        You cannot disable your own account. Ask another super admin if you need it done.
                      </p>
                    ) : (
                      <StatusForm adminId={account.id} status={account.status} />
                    )}
                    {account.mfaEnrolled ? <ResetMfaForm adminId={account.id} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </SuperAdminChrome>
  );
}
