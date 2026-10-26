import type { Metadata } from "next";
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

export default async function CategoriesPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me] = await Promise.all([getAdminCategories(), getAdminProfile()]);

  // The API refuses every call anyway; this only avoids showing forms that would bounce.
  if (me.ok && !me.data.permissions.includes(PERMISSION_TAXONOMY)) {
    return (
      <main className="mx-auto max-w-5xl px-4 pt-8">
        <h1 className="text-2xl font-bold">Categories</h1>
        <p className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          Your account cannot manage categories. Ask a super admin for the &quot;Manage categories,
          subcategories and localities&quot; permission.
        </p>
      </main>
    );
  }

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-5xl px-4 pt-8">
        <h1 className="text-2xl font-bold">Categories</h1>
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      </main>
    );
  }

  const categories = result.data;

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      <h1 className="text-2xl font-bold">Categories</h1>
      <p className="mt-1 text-neutral-600">
        Businesses are listed under a <strong>subcategory</strong>, so every category needs at least
        one. The public site picks changes up within a minute.
      </p>

      <Notice done={done} error={error} />

      {/* A web address is settled once and never edited: see AdminTaxonomyEndpoints for why. */}
      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Add a category</h2>
        <form action={addCategoryAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[12rem] text-sm">
            <span className="font-medium">Name</span>
            <input
              name="name"
              required
              maxLength={200}
              placeholder="Restaurants"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="font-medium">Under</span>
            <select name="parentId" className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2">
              <option value="">Nothing — a top-level category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium">Order</span>
            <input
              name="sortOrder"
              type="number"
              defaultValue={0}
              className="mt-1 w-24 rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900"
          >
            Add
          </button>
        </form>
      </section>

      {categories.length === 0 ? (
        <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          There are no categories yet. Add one above, then add a subcategory under it.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {categories.map((category) => (
            <li key={category.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <CategoryRow category={category} />

              <ul className="mt-3 space-y-2 border-l border-neutral-200 pl-4">
                {category.children.map((child) => (
                  <li key={child.id}>
                    <CategoryRow category={child} />
                  </li>
                ))}
                {category.children.length === 0 ? (
                  <li className="text-sm text-amber-700">
                    No subcategories yet, so no business can be listed under {category.name}.
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
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
    <div className="flex flex-wrap items-end justify-between gap-3">
      <form action={editCategoryAction.bind(null, category.id)} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="sr-only">Name</span>
          <input
            name="name"
            defaultValue={category.name}
            required
            maxLength={200}
            className="w-56 rounded-lg border border-neutral-300 px-3 py-1.5 font-medium"
          />
        </label>
        <label className="text-sm">
          <span className="sr-only">Order</span>
          <input
            name="sortOrder"
            type="number"
            defaultValue={category.sortOrder}
            className="w-20 rounded-lg border border-neutral-300 px-3 py-1.5"
          />
        </label>
        <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
          Save
        </button>
        <span className="text-sm text-neutral-500">
          /{category.slug} &middot; {category.listingCount} listing{category.listingCount === 1 ? "" : "s"}
        </span>
      </form>

      <div className="flex items-center gap-2">
        {category.isActive ? (
          <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">On the site</span>
        ) : (
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700">Switched off</span>
        )}

        <form action={toggleCategoryAction.bind(null, category.id, !category.isActive)}>
          <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
            {category.isActive ? "Switch off" : "Switch on"}
          </button>
        </form>

        {deletable ? (
          <form action={deleteCategoryAction.bind(null, category.id)}>
            <button type="submit" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
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
      <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
        {error}
      </p>
    );
  }
  if (done) {
    return (
      <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
        {done}
      </p>
    );
  }
  return null;
}
