import type { Metadata } from "next";
import { AccessDenied } from "@/components/AccessDenied";
import { EmptyState } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import { PERMISSION_HOMEPAGE, getAdminProfile, getScrollingText } from "@/lib/admin-api";
import { addLineAction, deleteLineAction, toggleLineAction } from "../actions";

export const metadata: Metadata = { title: "Scrolling text" };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

/**
 * The strip across the top of the public site — the original's `Admin/ScrollingText`.
 *
 * Before this, the strip scrolled subcategories picked in code, which meant changing it needed a
 * deploy. It still does that when this list is empty, so switching every line off is safe: the
 * strip goes back to scrolling the directory rather than going blank.
 *
 * The link is a path on this site and nothing else. That is enforced by the API and again by a
 * database CHECK (S0025), and the reason is worth stating on the screen as well as in the code: a
 * line typed here is rendered as a link on every public page, which is exactly how an open redirect
 * — or a `javascript:` URL — gets onto a site through its own admin panel.
 */
export default async function ScrollingTextPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me] = await Promise.all([getScrollingText(), getAdminProfile()]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_HOMEPAGE);

  if (me.ok && !mayEdit) {
    return <AccessDenied permission={PERMISSION_HOMEPAGE} what="the homepage" />;
  }

  const lines = result.ok ? result.data : [];
  const live = lines.filter((line) => line.isActive).length;

  return (
    <>
      <PageTitle title="Scrolling text" breadcrumb={[{ label: "Home page" }, { label: "Scrolling" }]} />

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

      {!result.ok ? (
        <div role="alert" className="alert alert-danger">
          {result.message}
        </div>
      ) : (
        <div className="row g-3">
          {mayEdit ? (
            <div className="col-xl-5">
              <div className="card h-100">
                <div className="card-body">
                  <h4 className="card-title mb-1">Add a line</h4>
                  <p className="card-title-desc mb-3">
                    The moving strip at the top of the public site. With no lines switched on it
                    scrolls the directory&rsquo;s own categories instead, so an empty list is safe.
                  </p>

                  <form action={addLineAction}>
                    <div className="mb-3">
                      <label className="form-label" htmlFor="message">
                        What it says
                      </label>
                      <input
                        id="message"
                        name="message"
                        maxLength={200}
                        required
                        placeholder="Ramzan offers across Old City — see the list"
                        className="form-control"
                      />
                    </div>

                    <div className="row g-2 mb-3">
                      <div className="col-sm-8">
                        <label className="form-label" htmlFor="url">
                          Where it goes (optional)
                        </label>
                        <input id="url" name="url" maxLength={300} placeholder="/verified" className="form-control" />
                        <div className="form-text">
                          A path on this site, starting with a single &ldquo;/&rdquo;. Links to
                          other sites are refused on purpose. Leave it blank for an announcement
                          with no link.
                        </div>
                      </div>
                      <div className="col-sm-4">
                        <label className="form-label" htmlFor="sortOrder">
                          Position
                        </label>
                        <input
                          id="sortOrder"
                          name="sortOrder"
                          type="number"
                          defaultValue={lines.length}
                          className="form-control"
                        />
                      </div>
                    </div>

                    <button type="submit" className="btn btn-primary">
                      Add
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ) : null}

          <div className={mayEdit ? "col-xl-7" : "col-12"}>
            <div className="card h-100">
              <div className="card-body">
                <h4 className="card-title mb-1">
                  Lines{lines.length > 0 ? ` (${live} of ${lines.length} showing)` : ""}
                </h4>
                <p className="card-title-desc mb-3">
                  Switching a line off is reversible and is the right tool for a seasonal one;
                  removing is for a line that was a mistake.
                </p>

                {lines.length === 0 ? (
                  <EmptyState icon="bx bx-text" title="Nothing written yet">
                    The strip is scrolling categories.
                  </EmptyState>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Line</th>
                          <th scope="col">Position</th>
                          {mayEdit ? (
                            <th scope="col" className="text-end">
                              Action
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => (
                          <tr key={line.id}>
                            <td className="py-3">
                              <span className={line.isActive ? "fw-semibold" : "fw-semibold text-muted"}>
                                {line.message}
                              </span>
                              {!line.isActive ? (
                                <span className="badge bg-secondary-subtle text-secondary ms-2">Off</span>
                              ) : null}
                              <span className="d-block text-muted font-size-12">
                                {line.url ?? "No link"}
                              </span>
                            </td>
                            <td className="py-3 text-muted">{line.sortOrder}</td>
                            {mayEdit ? (
                              <td className="py-3 text-end">
                                <div className="d-flex justify-content-end gap-2">
                                  <form action={toggleLineAction.bind(null, line.id, !line.isActive)}>
                                    <button type="submit" className="btn btn-sm btn-outline-secondary">
                                      {line.isActive ? "Switch off" : "Switch on"}
                                    </button>
                                  </form>
                                  <form action={deleteLineAction.bind(null, line.id)}>
                                    <button type="submit" className="btn btn-sm btn-outline-danger">
                                      Remove
                                    </button>
                                  </form>
                                </div>
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
