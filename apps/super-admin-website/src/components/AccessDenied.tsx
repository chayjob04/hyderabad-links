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
export function AccessDenied({ permission, what }: { permission?: string; what?: string }) {
  return (
    <main className="mx-auto max-w-xl px-5 py-16 sm:px-8">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-7 text-center">
        <p aria-hidden="true" className="text-4xl leading-none text-amber-700">
          &#9888;
        </p>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-amber-900">
          You do not have access to {what ?? "this screen"}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-amber-900">
          Your account is signed in, but your role does not include
          {permission ? (
            <>
              {" "}
              the <code className="rounded bg-amber-100 px-1.5 py-0.5 font-bold">{permission}</code>{" "}
              permission
            </>
          ) : (
            " this permission"
          )}
          . A super admin can add it to your role.
        </p>
        <p className="mt-6">
          <Link
            href="/"
            className="inline-block rounded-full bg-brand-700 px-5 py-2.5 text-sm font-black text-white hover:bg-brand-800"
          >
            Back to the overview
          </Link>
        </p>
      </div>
    </main>
  );
}
