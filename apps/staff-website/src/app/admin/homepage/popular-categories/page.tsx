import type { Metadata } from "next";
import { AccessDenied } from "@/components/AccessDenied";
import { PERMISSION_HOMEPAGE, getAdminProfile, getPopularCategories } from "@/lib/admin-api";
import { moveCategoryAction, togglePopularAction } from "../actions";

export const metadata: Metadata = { title: "Popular categories" };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

const INPUT =
  "w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

const BUTTON =
  "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50";

const PRIMARY = "rounded-lg bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-900";

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
    <p className="font-semibold">
      {name}
      {parentName ? (
        <span className="ml-2 text-sm font-normal text-neutral-500">in {parentName}</span>
      ) : null}
      {!isActive ? (
        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
          RETIRED
        </span>
      ) : null}
    </p>
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
    <main className="mx-auto max-w-4xl px-4 pt-8 pb-12">
      <h1 className="text-2xl font-bold">Popular categories</h1>
      <p className="mt-2 text-sm text-neutral-600">
        The categories shown under the search box on the homepage, in the order below. Choose none
        and the homepage falls back to the first seven top-level categories.
      </p>

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

      {!result.ok ? (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      ) : (
        <>
          <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">
              On the homepage{chosen.length > 0 ? ` (${chosen.length})` : ""}
            </h2>
            {chosen.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">None chosen. Pick some from the list below.</p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-200">
                {chosen.map((category) => (
                  <li key={category.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <CategoryLabel
                        name={category.name}
                        parentName={category.parentName}
                        isActive={category.isActive}
                      />
                      <p className="text-sm text-neutral-500">
                        {/* Said plainly: a chosen category with nothing on it is an empty section,
                            and staff should find that out here rather than on the homepage. */}
                        {category.listingCount === 0 ?
                          "No live listings — this would show an empty section"
                        : `${category.listingCount} live ${category.listingCount === 1 ? "listing" : "listings"}`}
                      </p>
                    </div>

                    {mayEdit ? (
                      <>
                        <form action={moveCategoryAction} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={category.id} />
                          <label className="text-sm text-neutral-600" htmlFor={`sort-${category.id}`}>
                            Position
                          </label>
                          <input
                            id={`sort-${category.id}`}
                            name="sortOrder"
                            type="number"
                            defaultValue={category.sortOrder}
                            className={INPUT}
                          />
                          <button type="submit" className={BUTTON}>
                            Save
                          </button>
                        </form>
                        <form action={togglePopularAction.bind(null, category.id, false)}>
                          <button type="submit" className={BUTTON}>
                            Remove
                          </button>
                        </form>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">Every other category</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Retired categories are listed too, so one can be chosen and reinstated together. A
              retired category never reaches the public homepage whatever is set here.
            </p>
            <ul className="mt-3 divide-y divide-neutral-200">
              {rest.map((category) => (
                <li key={category.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <CategoryLabel
                      name={category.name}
                      parentName={category.parentName}
                      isActive={category.isActive}
                    />
                    <p className="text-sm text-neutral-500">
                      {category.listingCount} live{" "}
                      {category.listingCount === 1 ? "listing" : "listings"}
                    </p>
                  </div>
                  {mayEdit ? (
                    <form action={togglePopularAction.bind(null, category.id, true)}>
                      <button type="submit" className={PRIMARY}>
                        Add to homepage
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
