import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { ListingStaffNav } from "@/components/ListingStaffNav";
import {
  LINK_TYPES,
  PERMISSION_LISTINGS_EDIT,
  getListing,
  getListingLinks,
  getProfile,
} from "@/lib/super-admin-api";
import { addLinkAction, deleteLinkAction } from "../content-actions";

export const metadata: Metadata = { title: "Links" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> };

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

const BUTTON =
  "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50";

const ADD = "rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700";

/**
 * Staff adding a listing's website and social links — the original's `Super/EditSocialLinks`.
 *
 * The URL is validated by the same code the owner's own screen uses
 * (`OwnerLinkEndpoints.TryNormalise`): http or https only, parsed rather than pattern-matched. That
 * sharing is deliberate — this is the one field on a listing page whose value becomes an `href` a
 * visitor's browser will follow, and two implementations of the rule is how one of them ends up
 * accepting `javascript:`.
 */
export default async function StaffLinksPage({ params, searchParams }: Props) {
  const { id: rawId } = await params;
  const { done, error } = await searchParams;
  if (!/^\d{1,15}$/.test(rawId)) notFound();
  const id = Number(rawId);

  const [listing, links, me] = await Promise.all([
    getListing(id),
    getListingLinks(id),
    getProfile(),
  ]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_EDIT);

  if (me.ok && !mayEdit) {
    return <AccessDenied permission={PERMISSION_LISTINGS_EDIT} what="this listing" />;
  }
  if (!listing.ok && listing.status === 404) notFound();

  const full = links.ok && links.data.used >= links.data.limit;

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <Link href="/listings" className="text-sm font-semibold text-brand-700 hover:underline">
        <span aria-hidden="true">&larr;</span> Listings
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{listing.ok ? listing.data.name : `Listing ${id}`}</h1>
      <ListingStaffNav listingId={id} current="links" />

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

      {!links.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {links.message}
        </p>
      ) : (
        <>
          <p className="mt-5 text-sm text-neutral-600">
            {links.data.used} of {links.data.limit} used on the {links.data.planName} plan.
            {links.data.limit === 0
              ? " This plan does not include links — the Verified plan does."
              : ""}
          </p>

          {mayEdit && !full && links.data.limit > 0 ? (
            <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold">Add a link</h2>
              <form action={addLinkAction.bind(null, id)} className="mt-4 grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-neutral-700" htmlFor="linkType">
                      Kind
                    </label>
                    <select id="linkType" name="linkType" className={`mt-1 ${INPUT}`} defaultValue="website">
                      {LINK_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-neutral-700" htmlFor="label">
                      Label
                    </label>
                    <input
                      id="label"
                      name="label"
                      maxLength={80}
                      required
                      placeholder="Our website"
                      className={`mt-1 ${INPUT}`}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-semibold text-neutral-700" htmlFor="url">
                    Web address
                  </label>
                  <input
                    id="url"
                    name="url"
                    type="url"
                    maxLength={1000}
                    required
                    placeholder="https://example.com"
                    className={`mt-1 ${INPUT}`}
                  />
                  <p className="mt-1 text-xs text-neutral-500">
                    A full address starting with http:// or https://. Anything else is refused.
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
              This listing has all {links.data.limit} links its plan allows. Remove one to add
              another.
            </p>
          ) : null}

          <section className="mt-6">
            <h2 className="text-base font-semibold">Links</h2>
            {links.data.items.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">None added yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white shadow-sm">
                {links.data.items.map((link) => (
                  <li key={link.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {link.label}
                        <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-neutral-600 uppercase">
                          {link.linkType}
                        </span>
                      </p>
                      {/* noreferrer as well as noopener: staff should not be leaking this panel's
                          URL to whatever a business put in the field. */}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm break-all text-brand-700 hover:underline"
                      >
                        {link.url}
                      </a>
                    </div>
                    {mayEdit ? (
                      <form action={deleteLinkAction.bind(null, id, link.id)}>
                        <button type="submit" className={BUTTON}>
                          Remove
                        </button>
                      </form>
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
