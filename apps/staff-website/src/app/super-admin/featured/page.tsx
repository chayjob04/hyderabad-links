import type { Metadata } from "next";
import Link from "next/link";
import { SuperAdminChrome } from "@/components/SuperAdminChrome";
import { EmptyState } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_LISTINGS_FEATURE,
  formatWhen,
  getFeatured,
  getHomepageGroups,
  type HomepageGroup,
  getProfile,
} from "@/lib/super-admin-api";
import { removeFromShelfAction } from "./actions";
import { moveToGroupAction } from "./group-actions";
import { HomepageGroups } from "./HomepageGroups";
import { ConfirmButton } from "@/components/ConfirmButton";

export const metadata: Metadata = { title: "Featured", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

/**
 * The homepage Featured shelf, in the order visitors see it.
 *
 * This page only removes. Adding happens from a listing's own page, because choosing a business to
 * recommend means looking at it first — a picker on this screen would invite choosing from a list of
 * names, which is how the wrong shop ends up on the front page.
 *
 * Trending is not here, and has no screen anywhere: it is counted from enquiries, favourites and
 * approved reviews over the last 30 days. A homepage where one shelf is curated and the other is
 * earned only works if nobody can touch the earned one.
 */
export default async function FeaturedPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me, groups] = await Promise.all([getFeatured(), getProfile(), getHomepageGroups()]);
  const mayFeature = me.ok && me.data.permissions.includes(PERMISSION_LISTINGS_FEATURE);

  return (
    <SuperAdminChrome>
      {/* The heading said "Verified listing", which this screen has nothing to do with: a listing
          is verified by an active subscription, not by being featured. */}
      <PageTitle
        title="Listing groups"
        breadcrumb={[{ label: "Website Management" }, { label: "Listing groups" }]}
        action={
          /* The way in. Adding happens from the listings page, where each row has a Feature
             toggle, so this page needs to say where that is rather than leaving someone looking
             for an "add" button that is deliberately not here. */
          <Link href="/super-admin/listings?status=active" className="btn btn-primary">
            Add listings <i className="mdi mdi-arrow-right ms-1" />
          </Link>
        }
      />

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

      <div className="row g-3 mb-4">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Homepage Featured shelf</h4>
              <p className="card-title-desc mb-3">
                Chosen by hand, newest choice first. Featuring a listing again moves it to the
                front. To add one, open <strong>Listings</strong> and use the{" "}
                <strong>Feature</strong> toggle on any live listing.
              </p>

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.message}
                </div>
              ) : (
                <>
                  <p className="text-muted font-size-13">
                    {result.data.items.length} of {result.data.max} slots used.{" "}
                    {result.data.remaining === 0
                      ? "The shelf is full: take one off before adding another."
                      : `${result.data.remaining} free.`}
                  </p>

                  {result.data.items.length === 0 ? (
                    <EmptyState icon="bx bx-star" title="Nothing is featured yet">
                      The homepage shows no Featured section until something is on this shelf. Open{" "}
                      <Link href="/super-admin/listings?status=active">Listings</Link> and switch{" "}
                      <strong>Feature</strong> on for any live business.
                    </EmptyState>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-hover align-middle mb-0">
                        <thead className="table-light">
                          <tr>
                            <th scope="col" style={{ width: "3rem" }}>
                              #
                            </th>
                            <th scope="col">Listing</th>
                            <th scope="col">Chosen</th>
                            <th scope="col" className="text-end">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.data.items.map((row, index) => (
                            <tr key={row.id}>
                              <td className="py-3 text-muted">{index + 1}</td>
                              <td className="py-3">
                                <Link
                                  href={`/super-admin/listings/${row.id}`}
                                  className="fw-semibold text-body"
                                >
                                  {row.name}
                                </Link>
                                {/* A featured listing can be suspended afterwards. The homepage
                                    drops it immediately, but it stays on the shelf until somebody
                                    takes it off, so this row has to say why it is not showing. */}
                                {row.status !== "active" ? (
                                  <span className="badge bg-warning-subtle text-warning ms-2">
                                    {row.status.replace("_", " ")} — not showing
                                  </span>
                                ) : null}
                              </td>
                              <td className="py-3 text-muted font-size-13">
                                {formatWhen(row.featuredAt)}
                                {row.featuredBy ? (
                                  <span className="d-block font-size-12">by {row.featuredBy}</span>
                                ) : null}
                              </td>
                              <td className="py-3 text-end">
                                <div className="d-flex justify-content-end align-items-center gap-2">
                                  {row.url ? (
                                    <a
                                      href={row.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="btn btn-sm btn-outline-secondary"
                                    >
                                      Public page
                                    </a>
                                  ) : null}
                                  {/* Which shelf it sits on. The endpoint, the client call and the
                                      server action for this all existed and nothing rendered a
                                      control for them, so a named shelf could be created, renamed
                                      and deleted but never filled — every featured listing stayed
                                      on the default strip and `/groups/<slug>` was always empty. */}
                                  {mayFeature && groups.ok && groups.data.items.length > 0 ? (
                                    <form
                                      action={moveToGroupAction.bind(null, row.id)}
                                      className="d-flex align-items-center gap-1"
                                    >
                                      <label className="visually-hidden" htmlFor={`shelf-${row.id}`}>
                                        Shelf for {row.name}
                                      </label>
                                      {/* A select and a submit, not submit-on-change: this page is a
                                          server component, so it cannot carry an onChange handler,
                                          and every other control here is a plain form too. */}
                                      <select
                                        id={`shelf-${row.id}`}
                                        name="groupId"
                                        className="form-select form-select-sm w-auto"
                                        defaultValue={String(row.homepageGroupId ?? 0)}
                                      >
                                        <option value="0">Default strip</option>
                                        {groups.data.items.map((group: HomepageGroup) => (
                                          <option key={group.id} value={String(group.id)}>
                                            {group.title}
                                          </option>
                                        ))}
                                      </select>
                                      <button type="submit" className="btn btn-sm btn-outline-secondary">
                                        Move
                                      </button>
                                    </form>
                                  ) : null}
                                  {mayFeature ? (
                                    <form action={removeFromShelfAction.bind(null, row.id)}>
                                      <ConfirmButton
                                        label="Take off"
                                        title="Take this off the Featured shelf?"
                                        subject={row.name}
                                        confirmLabel="Take off the shelf"
                                        tone="archive"
                                      >
                                        The homepage stops recommending it. The listing itself is
                                        untouched, and it can be featured again at any time.
                                      </ConfirmButton>
                                    </form>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {groups.ok ? <HomepageGroups groups={groups.data} mayEdit={mayFeature} /> : null}

      {!mayFeature ? (
        <div className="alert alert-light border font-size-13">
          Your account can see the shelf but not change it. It needs the &quot;Choose which listings
          appear on the homepage Featured shelf&quot; permission.
        </div>
      ) : null}
    </SuperAdminChrome>
  );
}
