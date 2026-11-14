import Link from "next/link";

/**
 * What an admin sees when they are signed in but not allowed to do something — the original's
 * `Admin/Shared/AccessDenied`.
 *
 * It names the permission, because the fix is for a super admin to grant it and nobody can ask for
 * a permission they have not been told the name of. It is deliberately not a 404: pretending the
 * screen does not exist would have the person hunting for a broken link instead of asking.
 *
 * This only draws the refusal. The API refuses the request itself, every time, whatever this
 * component renders — hiding a screen is never the control (see CLAUDE.md).
 */
export function AccessDenied({
  permission,
  what,
  surface = "admin",
}: {
  permission?: string;
  what?: string;
  /* Which dashboard "back" returns to. It has to be told: a server component cannot read the path,
     and now that both surfaces live in one deployment, "/" is the sign-in page rather than either
     dashboard. Defaulting to admin keeps the admin callers unchanged. */
  surface?: "admin" | "super";
}) {
  const back =
    surface === "super"
      ? { href: "/super-admin/overview", label: "Back to the overview" }
      : { href: "/admin", label: "Back to the dashboard" };

  return (
    <div className="row justify-content-center">
      <div className="col-xl-6 col-lg-8">
        <div className="card mt-4">
          <div className="card-body text-center py-5">
            <div className="avatar-md mx-auto mb-4">
              <span className="avatar-title bg-warning-subtle text-warning rounded-circle font-size-24">
                <i className="bx bx-shield-x" />
              </span>
            </div>

            <h4 className="mb-3">You do not have access to {what ?? "this screen"}</h4>

            <p className="text-muted mb-4">
              Your account is signed in, but your role does not include
              {permission ? (
                <>
                  {" "}
                  the <code className="text-body">{permission}</code> permission
                </>
              ) : (
                " this permission"
              )}
              . A super admin can add it to your role.
            </p>

            <Link href={back.href} className="btn btn-primary">
              {back.label}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
