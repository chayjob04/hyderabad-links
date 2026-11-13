import type { Metadata } from "next";
import { EmptyState } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import { PERMISSION_TAXONOMY, getAdminCategories, getAdminProfile, type AdminCategory } from "@/lib/admin-api";
import {
  addCategoryAction,
  deleteCategoryAction,
  editCategoryAction,
  toggleCategoryAction,
} from "./actions";

export const metadata: Metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

/**
 * Categories and their subcategories, on the original's Minia layout.
 *
 * Businesses are listed under a subcategory, so the hierarchy is the point of the screen: each
 * category is a card, and its subcategories are indented inside it against a left rule. A flat
 * table would lose the one relationship that matters here.
 */
export default async function CategoriesPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me] = await Promise.all([getAdminCategories(), getAdminProfile()]);

  const title = <PageTitle title="Categories view" breadcrumb={[{ label: "Configurations" }, { label: "Categories" }]} />;

  // The API refuses every call anyway; this only avoids showing forms that would bounce.
  if (me.ok && !me.data.permissions.includes(PERMISSION_TAXONOMY)) {
    return (
      <>
        {title}
        <div className="alert alert-light border">
          Your account cannot manage categories. Ask a super admin for the &quot;Manage categories,
          subcategories and localities&quot; permission.
        </div>
      </>
    );
  }

  if (!result.ok) {
    return (
      <>
        {title}
        <div role="alert" className="alert alert-danger">
          {result.message}
        </div>
      </>
    );
  }

  const categories = result.data;

  return (
    <>
      {title}
      <Notice done={done} error={error} />

      {/* A web address is settled once and never edited: see AdminTaxonomyEndpoints for why. */}
      <div className="row g-3 mb-4">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-1">Add a category</h4>
              <p className="card-title-desc mb-3">
                Businesses are listed under a <strong>subcategory</strong>, so every category needs
                at least one. The public site picks changes up within a minute.
              </p>

              <form action={addCategoryAction} className="row g-2 align-items-end">
                <div className="col-md-5">
                  <label htmlFor="name" className="form-label">
                    Name
                  </label>
                  <input
                    id="name"
                    name="name"
                    required
                    maxLength={200}
                    placeholder="Restaurants"
                    className="form-control"
                  />
                </div>
                <div className="col-md-4">
                  <label htmlFor="parentId" className="form-label">
                    Under
                  </label>
                  <select id="parentId" name="parentId" className="form-select">
                    <option value="">Nothing — a top-level category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <label htmlFor="sortOrder" className="form-label">
                    Order
                  </label>
                  <input id="sortOrder" name="sortOrder" type="number" defaultValue={0} className="form-control" />
                </div>
                <div className="col-md-1">
                  <button type="submit" className="btn btn-primary w-100">
                    Add
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <EmptyState icon="bx bx-category" title="There are no categories yet">
              Add one above, then add a subcategory under it.
            </EmptyState>
          </div>
        </div>
      ) : (
        <div className="row g-3">
          {categories.map((category) => (
            <div key={category.id} className="col-12">
              <div className="card mb-0">
                <div className="card-body">
                  <CategoryRow category={category} />

                  <div className="border-start ps-3 ms-2 mt-3">
                    {category.children.map((child) => (
                      <div key={child.id} className="py-2 border-bottom">
                        <CategoryRow category={child} />
                      </div>
                    ))}
                    {category.children.length === 0 ? (
                      <p className="text-warning font-size-13 mb-0">
                        No subcategories yet, so no business can be listed under {category.name}.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * One category or subcategory: rename and reorder in one submit, then switch off or delete. Delete
 * is only offered when nothing points at the row — the API refuses it otherwise, but offering a
 * button that always fails is worse than not offering it.
 */
function CategoryRow({ category }: { category: AdminCategory }) {
  const deletable = category.listingCount === 0 && category.children.length === 0;

  return (
    <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
      <form
        action={editCategoryAction.bind(null, category.id)}
        className="d-flex flex-wrap align-items-center gap-2"
      >
        <label className="visually-hidden" htmlFor={`name-${category.id}`}>
          Name
        </label>
        <input
          id={`name-${category.id}`}
          name="name"
          defaultValue={category.name}
          required
          maxLength={200}
          className="form-control form-control-sm fw-semibold"
          style={{ width: "14rem" }}
        />

        <label className="visually-hidden" htmlFor={`order-${category.id}`}>
          Order
        </label>
        <input
          id={`order-${category.id}`}
          name="sortOrder"
          type="number"
          defaultValue={category.sortOrder}
          className="form-control form-control-sm"
          style={{ width: "5rem" }}
        />

        <button type="submit" className="btn btn-sm btn-outline-secondary">
          Save
        </button>

        <span className="text-muted font-size-12">
          /{category.slug} &middot; {category.listingCount} listing
          {category.listingCount === 1 ? "" : "s"}
        </span>
      </form>

      <div className="d-flex align-items-center gap-2">
        <span
          className={`badge ${
            category.isActive ? "bg-success-subtle text-success" : "bg-secondary-subtle text-secondary"
          }`}
        >
          {category.isActive ? "On the site" : "Switched off"}
        </span>

        <form action={toggleCategoryAction.bind(null, category.id, !category.isActive)}>
          <button type="submit" className="btn btn-sm btn-outline-secondary">
            {category.isActive ? "Switch off" : "Switch on"}
          </button>
        </form>

        {deletable ? (
          <form action={deleteCategoryAction.bind(null, category.id)}>
            <button type="submit" className="btn btn-sm btn-outline-danger">
              Delete
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function Notice({ done, error }: { done?: string; error?: string }) {
  if (error) {
    return (
      <div role="alert" className="alert alert-danger">
        {error}
      </div>
    );
  }
  if (done) {
    return (
      <div role="status" className="alert alert-success">
        {done}
      </div>
    );
  }
  return null;
}
