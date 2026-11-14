import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/AccessDenied";
import { ListingStaffNav } from "@/components/ListingStaffNav";
import { PageTitle } from "@/components/minia/PageTitle";
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
    return <AccessDenied surface="super" permission={PERMISSION_LISTINGS_EDIT} what="this listing" />;
  }
  if (!listing.ok && listing.status === 404) notFound();

  const full = links.ok && links.data.used >= links.data.limit;
  const name = listing.ok ? listing.data.name : `Listing ${id}`;

  return (
    <>
      <PageTitle
        title={name}
        breadcrumb={[{ label: "Listings", href: "/super-admin/listings" }, { label: "Links" }]}
        action={
          <Link href={`/super-admin/listings/${id}`} className="btn btn-outline-secondary">
            <i className="mdi mdi-arrow-left me-1" /> Listing
          </Link>
        }
      />

      <ListingStaffNav listingId={id} current="links" />

      {done ? (
        <div role="status" className="alert alert-success">
          {done}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      ) : null}

      {!links.ok ? (
        <div role="alert" className="alert alert-danger">
          {links.message}
        </div>
      ) : (
        <div className="row g-3">
          <div className="col-xl-5">
            <div className="card h-100">
              <div className="card-body">
                <h4 className="card-title mb-1">Add a link</h4>
                <p className="card-title-desc mb-3">
                  {links.data.used} of {links.data.limit} used on the {links.data.planName} plan.
                  {links.data.limit === 0
                    ? " This plan does not include links — the Verified plan does."
                    : ""}
                </p>

                {mayEdit && !full && links.data.limit > 0 ? (
                  <form action={addLinkAction.bind(null, id)}>
                    <div className="row g-2 mb-3">
                      <div className="col-sm-5">
                        <label className="form-label" htmlFor="linkType">
                          Kind
                        </label>
                        <select id="linkType" name="linkType" className="form-select" defaultValue="website">
                          {LINK_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-sm-7">
                        <label className="form-label" htmlFor="label">
                          Label
                        </label>
                        <input
                          id="label"
                          name="label"
                          maxLength={80}
                          required
                          placeholder="Our website"
                          className="form-control"
                        />
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="form-label" htmlFor="url">
                        Web address
                      </label>
                      <input
                        id="url"
                        name="url"
                        type="url"
                        maxLength={1000}
                        required
                        placeholder="https://example.com"
                        className="form-control"
                      />
                      <div className="form-text">
                        A full address starting with http:// or https://. Anything else is refused.
                      </div>
                    </div>

                    <button type="submit" className="btn btn-primary">
                      Add
                    </button>
                  </form>
                ) : full ? (
                  <div className="alert alert-warning mb-0">
                    This listing has all {links.data.limit} links its plan allows. Remove one to add
                    another.
                  </div>
                ) : (
                  <p className="text-muted font-size-13 mb-0">Nothing can be added on this plan.</p>
                )}
              </div>
            </div>
          </div>

          <div className="col-xl-7">
            <div className="card h-100">
              <div className="card-body">
                <h4 className="card-title mb-1">Links</h4>
                <p className="card-title-desc mb-3">Shown on the public page in this order.</p>

                {links.data.items.length === 0 ? (
                  <p className="text-muted font-size-13 mb-0">None added yet.</p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Label</th>
                          <th scope="col">Address</th>
                          {mayEdit ? (
                            <th scope="col" className="text-end">
                              Action
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {links.data.items.map((link) => (
                          <tr key={link.id}>
                            <td className="py-3">
                              <span className="fw-semibold">{link.label}</span>
                              <span className="badge bg-secondary-subtle text-secondary ms-2">
                                {link.linkType}
                              </span>
                            </td>
                            <td className="py-3">
                              {/* noreferrer as well as noopener: staff should not be leaking this
                                  panel's URL to whatever a business put in the field. */}
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-break font-size-13"
                              >
                                {link.url}
                              </a>
                            </td>
                            {mayEdit ? (
                              <td className="py-3 text-end">
                                <form action={deleteLinkAction.bind(null, id, link.id)}>
                                  <button type="submit" className="btn btn-sm btn-outline-danger">
                                    Remove
                                  </button>
                                </form>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
