import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { ListingStaffNav } from "@/components/ListingStaffNav";
import {
  PERMISSION_LISTINGS_EDIT,
  getListing,
  getListingContent,
  getProfile,
} from "@/lib/super-admin-api";
import { addContentAction, deleteContentAction } from "../content-actions";

export const metadata: Metadata = { title: "About" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> };

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

const BUTTON =
  "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50";

const ADD = "rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700";

/**
 * Staff writing a listing's description sections — the original's `Super/EditListingContent`.
 *
 * Same reason as the FAQ editor: a business added by staff has no account to write its own About
 * with. The plan allowance is shown and enforced here too, and sections beyond it are marked
 * hidden rather than removed (D10).
 */
export default async function StaffContentPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { done, error } = await searchParams;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listing, content, me] = await Promise.all([
    getListing(id),
    getListingContent(id),
    getProfile(),
  ]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);

  if (me.ok && !mayEdit) {
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="this listing" />;
  }
  if (!listing.ok && listing.status === 404) notFound();

  const full = content.ok && content.data.used >= content.data.limit;

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <Link href="/super-admin/listings" className="text-sm font-semibold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> Listings
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{listing.ok ? listing.data.name : `Listing ${id}`}</h1>
      <ListingStaffNav listingId={id} current="content" />

      {done ? (
        <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      ) : null}

      {!content.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {content.message}
        </p>
      ) : (
        <>
          <p className="mt-5 text-sm text-neutral-600">
            {content.data.used} of {content.data.limit} used on the {content.data.planName} plan.
            {content.data.limit === 0
              ? " This plan does not include description sections — the Verified plan does."
              : ""}
          </p>

          {mayEdit && !full && content.data.limit > 0 ? (
            <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold">Add a section</h2>
              <form action={addContentAction.bind(null, id)} className="mt-4 grid gap-3">
                <div>
                  <label className="text-sm font-semibold text-neutral-700" htmlFor="heading">
                    Heading
                  </label>
                  <input
                    id="heading"
                    name="heading"
                    maxLength={200}
                    required
                    placeholder="About our clinic"
                    className={`mt-1 ${INPUT}`}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-neutral-700" htmlFor="body">
                    Text
                  </label>
                  <textarea
                    id="body"
                    name="body"
                    maxLength={4000}
                    rows={6}
                    required
                    className={`mt-1 ${INPUT}`}
                  />
                  <p className="mt-1 text-xs text-neutral-500">
                    Plain text. It is shown on the public page exactly as typed &mdash; markup is
                    not rendered.
                  </p>
                </div>
                <div>
                  <button type="submit" className={ADD}>
                    Add
                  </button>
                </div>
              </form>
            </section>
          ) : full ? (
            <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-amber-900">
              This listing has all {content.data.limit} sections its plan allows. Remove one to add
              another.
            </p>
          ) : null}

          <section className="mt-6">
            <h2 className="text-base font-semibold">Sections</h2>
            {content.data.items.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">Nothing written yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white shadow-sm">
                {content.data.items.map((section, index) => (
                  <li key={section.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{section.heading}</p>
                        <p className="mt-1 text-sm whitespace-pre-line text-neutral-600">
                          {section.body}
                        </p>
                      </div>
                      {mayEdit ? (
                        <form action={deleteContentAction.bind(null, id, section.id)}>
                          <button type="submit" className={BUTTON}>
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </div>
                    {index >= content.data.limit ? (
                      <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                        Hidden &mdash; beyond what the {content.data.planName} plan shows. It is kept
                        and returns if the plan is upgraded.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
