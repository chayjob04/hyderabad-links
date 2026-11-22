import type { Metadata } from "next";
import { EmptyState } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_TAXONOMY,
  getAdminCategories,
  getAdminProfile,
  getAdminSegments,
  type AdminCategory,
  type AdminSegment,
} from "@/lib/admin-api";
import {
  addCategoryAction,
  addSegmentAction,
  assignSegmentAction,
  deleteCategoryAction,
  editCategoryAction,
  toggleCategoryAction,
} from "./actions";
import { ConfirmButton } from "@/components/ConfirmButton";

export const metadata: Metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

/**
 * The taxonomy, on the original's Minia layout: Segment > Category > Subcategory.
 *
 * Businesses are listed under a subcategory, so the hierarchy is the point of the screen: each
 * category is a card, its subcategories are indented inside it against a left rule, and the segment
 * it belongs to is a dropdown on its header. A flat table would lose the one relationship that
 * matters here.
 *
 * Segments (S0030) are the tier above, listed in their own card at the top. They are rows in the
 * same table, so renaming, reordering, switching off and deleting one go through the same controls
 * and the same endpoints as a category -- only "add" and "move a category" are their own actions.
 */
export default async function CategoriesPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me, segmentResult] = await Promise.all([
    getAdminCategories(),
    getAdminProfile(),
    getAdminSegments(),
  ]);
  /* A failure here is not worth failing the screen for: the categories below are still manageable,
     and the segment controls simply are not offered. An API deployed before S0030 answers 404. */
  const segments = segmentResult.ok ? segmentResult.data : [];

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

      {/* ---------------------------------------------------------------- segments */}
      <div className="row g-3 mb-4">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-1">Segments</h4>
              <p className="card-title-desc mb-3">
                The top of the menu: Food, Stays, Services. A segment holds categories, and a
                category holds the subcategories businesses are listed under. Moving a category
                between segments does not change its web address.
              </p>

              <form action={addSegmentAction} className="row g-2 align-items-end mb-3">
                <div className="col-md-6">
                  <label htmlFor="segment-name" className="form-label">
                    Name
                  </label>
                  <input
                    id="segment-name"
                    name="name"
                    required
                    maxLength={200}
                    placeholder="Food"
                    className="form-control"
                  />
                </div>
                <div className="col-md-3">
                  <label htmlFor="segment-order" className="form-label">
                    Order
                  </label>
                  <input
                    id="segment-order"
                    name="sortOrder"
                    type="number"
                    defaultValue={0}
                    className="form-control"
                  />
                </div>
                <div className="col-md-3">
                  <button type="submit" className="btn btn-primary w-100">
                    Add segment
                  </button>
                </div>
              </form>

              {segments.length === 0 ? (
                <p className="text-muted font-size-13 mb-0">
                  No segments yet. Categories work without one; a segment groups them on the public
                  menu.
                </p>
              ) : (
                <div>
                  {segments.map((segment) => (
                    <div key={segment.id} className="py-2 border-bottom">
                      <CategoryRow
                        category={asRow(segment)}
                        /* A segment with categories under it cannot be deleted -- the API refuses
                           it, and a button that always fails is worse than no button. */
                        deletable={segment.categoryCount === 0}
                        countLabel={`${segment.categoryCount} categor${segment.categoryCount === 1 ? "y" : "ies"}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

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
                  {/* The tier of whatever is chosen decides the tier of the new row: a segment
                      makes a category, a category makes a subcategory. */}
                  <select id="parentId" name="parentId" className="form-select">
                    <option value="">Nothing — a category with no segment</option>
                    {segments.length > 0 ? (
                      <optgroup label="In a segment (makes a category)">
                        {segments.map((segment) => (
                          <option key={`s-${segment.id}`} value={segment.id}>
                            {segment.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    <optgroup label="Under a category (makes a subcategory)">
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </optgroup>
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

                  {segments.length > 0 ? (
                    <form
                      action={assignSegmentAction.bind(null, category.id)}
                      className="d-flex flex-wrap align-items-center gap-2 mt-2"
                    >
                      <label
                        className="text-muted font-size-12 mb-0"
                        htmlFor={`segment-${category.id}`}
                      >
                        Segment
                      </label>
                      <select
                        id={`segment-${category.id}`}
                        name="segmentId"
                        defaultValue={category.parentId ?? ""}
                        className="form-select form-select-sm"
                        style={{ width: "14rem" }}
                      >
                        <option value="">No segment</option>
                        {segments.map((segment) => (
                          <option key={segment.id} value={segment.id}>
                            {segment.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-sm btn-outline-secondary">
                        Move
                      </button>
                    </form>
                  ) : null}

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
function CategoryRow({
  category,
  deletable: deletableOverride,
  countLabel,
}: {
  category: AdminCategory;
  /** For a segment, whose "children" are categories and are counted separately. */
  deletable?: boolean;
  /** Replaces the listing count, which means nothing for a segment. */
  countLabel?: string;
}) {
  const deletable =
    deletableOverride ?? (category.listingCount === 0 && category.children.length === 0);

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
          /{category.slug} &middot;{" "}
          {countLabel ??
            `${category.listingCount} listing${category.listingCount === 1 ? "" : "s"}`}
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
            <ConfirmButton
              label="Delete"
              title="Delete this category?"
              subject={category.name}
              confirmLabel="Delete category"
            >
              It goes from the public site and from every menu that lists it. Nothing points at it,
              so nothing else changes. Switching it off instead keeps it, and keeps its listings
              working.
            </ConfirmButton>
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

/**
 * A segment in the shape `CategoryRow` renders.
 *
 * They are the same kind of row in the database -- one table, a `level` column -- so the controls
 * are the same controls and the endpoints behind them are the same endpoints. This is the seam, and
 * it is three lines rather than a second copy of the row.
 */
function asRow(segment: AdminSegment): AdminCategory {
  return {
    id: segment.id,
    level: 0,
    parentId: null,
    slug: segment.slug,
    name: segment.name,
    sortOrder: segment.sortOrder,
    isActive: segment.isActive,
    listingCount: 0,
    children: [],
  };
}
