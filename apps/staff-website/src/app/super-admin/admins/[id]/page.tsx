import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import { formatWhen, getAdminDetail, getProfile, listRoles } from "@/lib/super-admin-api";
import { ResetMfaForm, RolesForm, StatusForm } from "../AccountControls";
import { EditAdminForm, ResetPasswordForm, RevokeSessionsButton } from "../AdminControls";

export const metadata: Metadata = { title: "Admin account" };
export const dynamic = "force-dynamic";

/**
 * One administrator: their details, their access, and the state of their security.
 *
 * Everything heavier than a toggle lives here rather than in the table — editing details, resetting
 * a password, ending sessions — because each of them deserves a confirmation step and a sentence
 * saying what it will do.
 */
export default async function AdminAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const adminId = Number(id);
  if (!Number.isInteger(adminId) || adminId < 1) notFound();

  const [detail, roles, me] = await Promise.all([getAdminDetail(adminId), listRoles(), getProfile()]);

  if (!detail.ok) {
    return (
      <SuperAdminChrome>
        <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
          <Back />
          <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
            {detail.status === 404
              ? "There is no administrator with that id."
              : detail.status === 403
                ? "Your account cannot manage administrators."
                : detail.message}
          </p>
        </main>
      </SuperAdminChrome>
    );
  }

  const { account } = detail.data;
  const isMe = me.ok && me.data.id === account.id;

  return (
    <SuperAdminChrome>
      <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
        <Back />

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-neutral-900">
              {account.displayName}
              {isMe ? <span className="ml-2 text-base font-medium text-neutral-500">(you)</span> : null}
            </h1>
            <p className="mt-1 break-all text-neutral-600">{account.email}</p>
          </div>
          <span className="font-mono text-sm text-neutral-400">#{account.id}</span>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Status" value={account.status} />
          <Fact label="Authenticator" value={account.mfaEnrolled ? `set up · ${account.unusedRecoveryCodes} codes left` : "not set up"} />
          <Fact label="Last login" value={formatWhen(account.lastLoginAt)} />
          <Fact label="Password changed" value={formatWhen(account.passwordChangedAt)} />
        </section>

        {account.mustChangePassword ? (
          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This account is on a temporary password. It can do nothing but change it until it does.
          </p>
        ) : null}
        {account.locked ? (
          <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            Locked after {detail.data.failedLoginCount} failed sign-in attempts
            {detail.data.lockedUntil ? ` until ${formatWhen(detail.data.lockedUntil)}` : ""}. Resetting
            the password clears it.
          </p>
        ) : null}

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <Panel title="Account details" description="The name and address this person signs in with.">
            <EditAdminForm account={account} />
          </Panel>

          <Panel
            title="Reset password"
            description={
              isMe
                ? "Use Change my password for your own account — this form is for somebody else's."
                : "Sets a temporary password, ends every session, and forces a change at next sign-in."
            }
          >
            {isMe ? (
              <Link href="/super-admin/password" className="font-semibold text-brand-700 hover:underline">
                Change my password
              </Link>
            ) : (
              <ResetPasswordForm account={account} />
            )}
          </Panel>

          {roles.ok ? (
            <Panel title="Roles" description="What this account may reach. Read from the database on every request.">
              <RolesForm adminId={account.id} roles={account.roles} allRoles={roles.data} />
            </Panel>
          ) : null}

          <Panel title="Access" description="Whether the account may sign in at all, and its authenticator.">
            <div className="grid gap-4">
              <StatusForm adminId={account.id} status={account.status} />
              <ResetMfaForm adminId={account.id} />
            </div>
          </Panel>

          <Panel
            title="Sessions"
            description={`${detail.data.activeSessions} session${detail.data.activeSessions === 1 ? "" : "s"} could be refreshed right now.`}
          >
            <RevokeSessionsButton account={account} activeSessions={detail.data.activeSessions} />
            {detail.data.recentSessions.length > 0 ? (
              <ul className="mt-4 grid gap-2 text-xs text-neutral-600">
                {detail.data.recentSessions.map((session, index) => (
                  <li key={`${session.createdAt}-${index}`} className="flex flex-wrap justify-between gap-2 border-t border-neutral-100 pt-2">
                    <span>{formatWhen(session.createdAt)}</span>
                    <span className="text-neutral-500">{session.ip ?? "no address"}</span>
                    <span className={session.revoked ? "text-neutral-400" : "font-semibold text-green-700"}>
                      {session.revoked ? "ended" : "live"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-xs text-neutral-500">This account has never signed in.</p>
            )}
          </Panel>

          <Panel title="History" description="Where this account came from.">
            <dl className="grid gap-2 text-sm">
              <Row label="Created" value={formatWhen(account.createdAt)} />
              <Row label="Created by" value={detail.data.invitedByName ?? "the command line"} />
              <Row label="Failed sign-ins" value={String(detail.data.failedLoginCount)} />
            </dl>
            <p className="mt-4 text-xs text-neutral-500">
              Accounts are never deleted, only disabled, so the audit log and the record of what they
              approved stay intact.
            </p>
          </Panel>
        </section>
      </main>
    </SuperAdminChrome>
  );
}

function Back() {
  return (
    <Link href="/super-admin/admins" className="text-sm font-semibold text-brand-700 hover:underline">
      &larr; Admin Accounts
    </Link>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-neutral-600 uppercase">{label}</p>
      <p className="mt-1 text-sm font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-neutral-900">{title}</h2>
      <p className="mt-1 mb-4 text-sm text-neutral-600">{description}</p>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-t border-neutral-100 pt-2 first:border-0 first:pt-0">
      <dt className="text-neutral-600">{label}</dt>
      <dd className="font-medium text-neutral-900">{value}</dd>
    </div>
  );
}
