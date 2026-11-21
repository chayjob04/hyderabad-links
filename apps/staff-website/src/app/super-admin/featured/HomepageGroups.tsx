import type { HomepageGroupList } from "@/lib/super-admin-api";
import { createGroupAction, deleteGroupAction, updateGroupAction } from "./group-actions";

/**
 * Named shelves for the homepage.
 *
 * The original site did not have one Featured strip, it had several with titles somebody wrote —
 * "Best Cafes in Madhapur" and so on. A shelf is an editorial statement, so it has a heading
 * rather than being a layout setting.
 *
 * The default shelf is untouched by any of this: a featured listing with no shelf lands there,
 * which is what every currently-featured listing does. Creating shelves moves nothing on its own.
 *
 * A shelf with no live listings is not rendered on the homepage at all, which is why the count is
 * shown here — an empty shelf is invisible to visitors and easy to forget about otherwise.
 *
 * This component was missed when the Featured page was migrated and kept its Tailwind styling, so
 * it rendered as an un-themed block under a Minia card. It is the page's own card, table and form
 * classes now; nothing about what it does changed.
 */
export function HomepageGroups({ groups, mayEdit }: { groups: HomepageGroupList; mayEdit: boolean }) {
  const active = groups.items.filter((g) => g.isActive).length;
  const full = active >= groups.maxActive;

  return (
    <div className="row g-3">
      <div className="col-12">
        <div className="card mb-0">
          <div className="card-body">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-1">
              <h4 className="card-title mb-0">Named shelves</h4>
              <span className="badge bg-secondary-subtle text-secondary">
                {active} of {groups.maxActive} showing on the homepage
              </span>
            </div>
            <p className="card-title-desc mb-3">
              Extra strips below the main Featured one, each with its own heading. Listings you do
              not put on a shelf stay on the default Featured strip.
            </p>

            {groups.items.length === 0 ? (
              <p className="text-muted font-size-13">
                None yet. The homepage shows the single Featured strip, as it does today.
              </p>
            ) : (
              groups.items.map((group) => (
                <div key={group.id} className="border rounded p-3 mb-2">
                  {mayEdit ? (
                    <form action={updateGroupAction.bind(null, group.id)}>
                      <div className="row g-2 mb-2">
                        <div className="col-md-5">
                          <label className="visually-hidden" htmlFor={`title-${group.id}`}>
                            Heading
                          </label>
                          {/* 160 and 300 below match SuperAdminHomepageGroupEndpoints'
                              MaxTitleLength and MaxSubtitleLength, and their columns. */}
                          <input
                            id={`title-${group.id}`}
                            name="title"
                            defaultValue={group.title}
                            maxLength={160}
                            className="form-control form-control-sm fw-semibold"
                          />
                        </div>
                        <div className="col-md-5">
                          <label className="visually-hidden" htmlFor={`subtitle-${group.id}`}>
                            Subtitle
                          </label>
                          <input
                            id={`subtitle-${group.id}`}
                            name="subtitle"
                            defaultValue={group.subtitle ?? ""}
                            maxLength={300}
                            placeholder="Optional line under the heading"
                            className="form-control form-control-sm"
                          />
                        </div>
                        <div className="col-md-2">
                          <label className="visually-hidden" htmlFor={`order-${group.id}`}>
                            Order
                          </label>
                          <input
                            id={`order-${group.id}`}
                            name="sortOrder"
                            type="number"
                            defaultValue={group.sortOrder}
                            className="form-control form-control-sm"
                          />
                        </div>
                      </div>

                      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <div className="form-check mb-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            name="isActive"
                            id={`active-${group.id}`}
                            defaultChecked={group.isActive}
                          />
                          <label className="form-check-label font-size-13" htmlFor={`active-${group.id}`}>
                            Show on the homepage
                          </label>
                        </div>

                        <span className="text-muted font-size-12">
                          /{group.slug} &middot;{" "}
                          {group.listingCount === 0
                            ? "no listings, so it will not appear"
                            : `${group.listingCount} listing${group.listingCount === 1 ? "" : "s"}`}
                        </span>

                        <button type="submit" className="btn btn-sm btn-primary">
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="fw-semibold mb-0">{group.title}</p>
                  )}

                  {mayEdit ? (
                    <form
                      action={deleteGroupAction.bind(null, group.id)}
                      className="border-top mt-3 pt-2 d-flex flex-wrap align-items-center gap-2"
                    >
                      <button type="submit" className="btn btn-sm btn-outline-danger">
                        Remove this shelf
                      </button>
                      <span className="text-muted font-size-12">
                        Its listings stay featured and return to the default strip.
                      </span>
                    </form>
                  ) : null}
                </div>
              ))
            )}

            {mayEdit ? (
              <form action={createGroupAction} className="border-top mt-3 pt-3">
                <h5 className="font-size-14 mb-3">Add a shelf</h5>

                <div className="row g-2 align-items-end mb-2">
                  <div className="col-md-4">
                    <label className="form-label" htmlFor="new-title">
                      Heading
                    </label>
                    <input
                      id="new-title"
                      name="title"
                      maxLength={160}
                      placeholder="Best cafes in Madhapur"
                      className="form-control"
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label" htmlFor="new-subtitle">
                      Subtitle
                    </label>
                    <input
                      id="new-subtitle"
                      name="subtitle"
                      maxLength={300}
                      placeholder="Optional subtitle"
                      className="form-control"
                    />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label" htmlFor="new-order">
                      Order
                    </label>
                    <input
                      id="new-order"
                      name="sortOrder"
                      type="number"
                      defaultValue={0}
                      className="form-control"
                    />
                  </div>
                  <div className="col-md-2">
                    <button type="submit" className="btn btn-primary w-100">
                      Add
                    </button>
                  </div>
                </div>

                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    name="isActive"
                    id="new-active"
                    defaultChecked={!full}
                    disabled={full}
                  />
                  <label className="form-check-label font-size-13" htmlFor="new-active">
                    Show on the homepage
                    {full ? (
                      <span className="text-muted ms-1">
                        ({groups.maxActive} already showing &mdash; switch one off first)
                      </span>
                    ) : null}
                  </label>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
