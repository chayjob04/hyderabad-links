import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import { PageTitle } from "@/components/minia/PageTitle";
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
 *
 * Presented on the original theme's cards. The data and the actions are unchanged.
 */
export default async function AdminAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const adminId = Number(id);
  if (!Number.isInteger(adminId) || adminId < 1) notFound();

  const [detail, roles, me] = await Promise.all([getAdminDetail(adminId), listRoles(), getProfile()]);

  if (!detail.ok) {
    return (
      <SuperAdminChrome>
        <PageTitle
          title="Admin account"
          breadcrumb={[{ label: "Admins", href: "/super-admin/admins" }, { label: "Account" }]}
        />
        <div className="alert alert-danger" role="alert">
          {detail.status === 404
            ? "There is no administrator with that id."
            : detail.status === 403
              ? "Your account cannot manage administrators."
              : detail.message}
        </div>
      </SuperAdminChrome>
    );
  }

  const { account } = detail.data;
  const isMe = me.ok && me.data.id === account.id;

  return (
    <SuperAdminChrome>
      <PageTitle
        title={account.displayName}
        breadcrumb={[{ label: "Admins", href: "/super-admin/admins" }, { label: `#${account.id}` }]}
      />

      {/* Who this is, and the four facts worth seeing before anything else. */}
      <div className="card mb-3">
        <div className="card-body">
          <div className="d-flex align-items-center mb-4">
            <div className="avatar-md me-3">
              <span className="avatar-title bg-primary-subtle text-primary rounded-circle font-size-24">
                <i className="bx bx-user" />
              </span>
            </div>
            <div className="flex-grow-1">
              <h5 className="mb-1">
                {account.displayName}
                {isMe ? <span className="text-muted font-size-13 fw-normal ms-2">(you)</span> : null}
              </h5>
              <p className="text-muted mb-0">{account.email}</p>
            </div>
            <Link href="/super-admin/admins" className="btn btn-light btn-sm">
              <i className="mdi mdi-arrow-left me-1" /> Back
            </Link>
          </div>

          <div className="row g-3">
            <Fact label="Status" value={account.status} />
            <Fact
              label="Authenticator"
              value={account.mfaEnrolled ? `set up · ${account.unusedRecoveryCodes} codes left` : "not set up"}
            />
            <Fact label="Last login" value={formatWhen(account.lastLoginAt)} />
            <Fact label="Password changed" value={formatWhen(account.passwordChangedAt)} />
          </div>

          {account.mustChangePassword ? (
            <div className="alert alert-warning mt-3 mb-0">
              This account is on a temporary password. It can do nothing but change it until it does.
            </div>
          ) : null}
          {account.locked ? (
            <div className="alert alert-danger mt-3 mb-0">
              Locked after {detail.data.failedLoginCount} failed sign-in attempts
              {detail.data.lockedUntil ? ` until ${formatWhen(detail.data.lockedUntil)}` : ""}. Resetting
              the password clears it.
            </div>
          ) : null}
        </div>
      </div>

      <div className="row mb-3">
        <div className="col-xl-6">
          <Panel title="Account details" description="The name and address this person signs in with.">
            <EditAdminForm account={account} />
          </Panel>
        </div>

        <div className="col-xl-6">
          <Panel
            title="Reset password"
            description={
              isMe
                ? "Use Change my password for your own account — this form is for somebody else's."
                : "Sets a temporary password, ends every session, and forces a change at next sign-in."
            }
          >
            {isMe ? (
              <Link href="/super-admin/password" className="btn btn-primary">
                Change my password
              </Link>
            ) : (
              <ResetPasswordForm account={account} />
            )}
          </Panel>
        </div>

        {roles.ok ? (
          <div className="col-xl-6">
            <Panel title="Roles" description="What this account may reach. Read from the database on every request.">
              <RolesForm adminId={account.id} roles={account.roles} allRoles={roles.data} />
            </Panel>
          </div>
        ) : null}

        <div className="col-xl-6">
          <Panel title="Access" description="Whether the account may sign in at all, and its authenticator.">
            <div className="row g-3">
              <div className="col-sm-6">
                <StatusForm adminId={account.id} status={account.status} />
              </div>
              <div className="col-sm-6">
                <ResetMfaForm adminId={account.id} />
              </div>
            </div>
          </Panel>
        </div>

        <div className="col-xl-6">
          <Panel
            title="Sessions"
            description={`${detail.data.activeSessions} session${detail.data.activeSessions === 1 ? "" : "s"} could be refreshed right now.`}
          >
            <RevokeSessionsButton account={account} activeSessions={detail.data.activeSessions} />
            {detail.data.recentSessions.length > 0 ? (
              <div className="table-responsive mt-3">
                <table className="table table-sm align-middle mb-0 font-size-13">
                  <thead className="table-light">
                    <tr>
                      <th scope="col">Started</th>
                      <th scope="col">Address</th>
                      <th scope="col">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.recentSessions.map((session, index) => (
                      <tr key={`${session.createdAt}-${index}`}>
                        <td>{formatWhen(session.createdAt)}</td>
                        <td className="text-muted">{session.ip ?? "no address"}</td>
                        <td>
                          <span
                            className={`badge ${session.revoked ? "bg-secondary-subtle text-secondary" : "bg-success-subtle text-success"}`}
                          >
                            {session.revoked ? "ended" : "live"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted font-size-13 mt-3 mb-0">This account has never signed in.</p>
            )}
          </Panel>
        </div>

        <div className="col-xl-6">
          <Panel title="History" description="Where this account came from.">
            <table className="table table-sm mb-3">
              <tbody>
                <Row label="Created" value={formatWhen(account.createdAt)} />
                <Row label="Created by" value={detail.data.invitedByName ?? "the command line"} />
                <Row label="Failed sign-ins" value={String(detail.data.failedLoginCount)} />
              </tbody>
            </table>
            <p className="text-muted font-size-12 mb-0">
              Accounts are never deleted, only disabled, so the audit log and the record of what they
              approved stay intact.
            </p>
          </Panel>
        </div>
      </div>
    </SuperAdminChrome>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-sm-6 col-xl-3">
      <div className="border rounded p-3 h-100">
        <p className="text-muted font-size-12 text-uppercase mb-1">{label}</p>
        <p className="fw-semibold mb-0">{value}</p>
      </div>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card h-100 mb-3">
      <div className="card-body">
        <h4 className="card-title mb-1">{title}</h4>
        <p className="card-title-desc mb-3">{description}</p>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th scope="row" className="fw-normal text-muted ps-0">
        {label}
      </th>
      <td className="text-end fw-semibold pe-0">{value}</td>
    </tr>
  );
}
