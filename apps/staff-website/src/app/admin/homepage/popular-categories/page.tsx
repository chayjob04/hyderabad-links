import type { Metadata } from "next";
import { AccessDenied } from "@/components/AccessDenied";
import { PageTitle } from "@/components/minia/PageTitle";
import { PERMISSION_HOMEPAGE, getAdminProfile, getPopularCategories } from "@/lib/admin-api";
import { moveCategoryAction, togglePopularAction } from "../actions";

export const metadata: Metadata = { title: "Popular categories" };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

/** The name, its parent, and whether it has been retired — the same three facts on both lists. */
function CategoryLabel({
  name,
  parentName,
  isActive,
}: {
  name: string;
  parentName: string | null;
  isActive: boolean;
}) {
  return (
    <>
      <span className="fw-semibold">{name}</span>
      {parentName ? <span className="text-muted font-size-13 ms-2">in {parentName}</span> : null}
      {!isActive ? (
        <span className="badge bg-warning-subtle text-warning ms-2">Retired</span>
      ) : null}
    </>
  );
}

/**
 * Which categories lead the public homepage — the original's `Admin/PopularCategories`.
 *
 * One list with a toggle on each row, rather than a chosen list beside a separate picker. The
 * two-box version is how a category ends up in neither: it leaves one side and never arrives at the
 * other, and nothing on screen shows it has gone missing.
 *
 * The position field is the category's own `sort_order`, shared with the directory tree. That is
 * deliberate rather than a second ordering column: a category has one position, so the homepage
 * cannot disagree with the menu about which section comes first.
 *
 * Choosing nothing is a valid state. The homepage then shows the first seven top-level categories,
 * which is what it did before this screen existed, so clearing the list cannot empty the page.
 */
export default async function PopularCategoriesPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me] = await Promise.all([getPopularCategories(), getAdminProfile()]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_HOMEPAGE);

  // Only once we know who they are: a failed profile read is a different problem from a refusal.
  if (me.ok && !mayEdit) {
    return <AccessDenied permission={PERMISSION_HOMEPAGE} what="the homepage" />;
  }

  const all = result.ok ? result.data : [];
  const chosen = all.filter((category) => category.isPopular);
  const rest = all.filter((category) => !category.isPopular);

  return (
    <>
      <PageTitle
        title="Popular categories"
        breadcrumb={[{ label: "Home page" }, { label: "Popular categories" }]}
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

      {!result.ok ? (
        <div role="alert" className="alert alert-danger">
          {result.message}
        </div>
      ) : (
        <div className="row g-3">
          <div className="col-xl-6">
            <div className="card h-100">
              <div className="card-body">
                <h4 className="card-title mb-1">
                  On the homepage{chosen.length > 0 ? ` (${chosen.length})` : ""}
                </h4>
                <p className="card-title-desc mb-3">
                  Shown under the search box, in the order below. Choose none and the homepage falls
                  back to the first seven top-level categories.
                </p>

                {chosen.length === 0 ? (
                  <p className="text-muted font-size-13 mb-0">
                    None chosen. Pick some from the list beside this one.
                  </p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Category</th>
                          {mayEdit ? (
                            <th scope="col" className="text-end">
                              Position
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {chosen.map((category) => (
                          <tr key={category.id}>
                            <td className="py-3">
                              <CategoryLabel
                                name={category.name}
                                parentName={category.parentName}
                                isActive={category.isActive}
                              />
                              {/* Said plainly: a chosen category with nothing on it is an empty
                                  section, and staff should find that out here rather than on the
                                  homepage. */}
                              <span
                                className={`d-block font-size-12 ${
                                  category.listingCount === 0 ? "text-warning" : "text-muted"
                                }`}
                              >
                                {category.listingCount === 0
                                  ? "No live listings — this would show an empty section"
                                  : `${category.listingCount} live ${
                                      category.listingCount === 1 ? "listing" : "listings"
                                    }`}
                              </span>
                            </td>
                            {mayEdit ? (
                              <td className="py-3">
                                <div className="d-flex justify-content-end align-items-center gap-2">
                                  <form
                                    action={moveCategoryAction}
                                    className="d-flex align-items-center gap-2"
                                  >
                                    <input type="hidden" name="id" value={category.id} />
                                    <label className="visually-hidden" htmlFor={`sort-${category.id}`}>
                                      Position
                                    </label>
                                    <input
                                      id={`sort-${category.id}`}
                                      name="sortOrder"
                                      type="number"
                                      defaultValue={category.sortOrder}
                                      className="form-control form-control-sm"
                                      style={{ width: "4.5rem" }}
                                    />
                                    <button type="submit" className="btn btn-sm btn-outline-secondary">
                                      Save
                                    </button>
                                  </form>
                                  <form action={togglePopularAction.bind(null, category.id, false)}>
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

          <div className="col-xl-6">
            <div className="card h-100">
              <div className="card-body">
                <h4 className="card-title mb-1">Every other category</h4>
                <p className="card-title-desc mb-3">
                  Retired categories are listed too, so one can be chosen and reinstated together. A
                  retired category never reaches the public homepage whatever is set here.
                </p>

                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col">Category</th>
                        {mayEdit ? (
                          <th scope="col" className="text-end">
                            Action
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {rest.map((category) => (
                        <tr key={category.id}>
                          <td className="py-3">
                            <CategoryLabel
                              name={category.name}
                              parentName={category.parentName}
                              isActive={category.isActive}
                            />
                            <span className="d-block text-muted font-size-12">
                              {category.listingCount} live{" "}
                              {category.listingCount === 1 ? "listing" : "listings"}
                            </span>
                          </td>
                          {mayEdit ? (
                            <td className="py-3 text-end">
                              <form action={togglePopularAction.bind(null, category.id, true)}>
                                <button type="submit" className="btn btn-sm btn-primary">
                                  Add to homepage
                                </button>
                              </form>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
