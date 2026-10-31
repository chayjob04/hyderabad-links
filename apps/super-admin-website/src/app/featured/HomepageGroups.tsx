import type { HomepageGroupList } from "@/lib/super-admin-api";
import { createGroupAction, deleteGroupAction, updateGroupAction } from "./group-actions";

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

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
 */
export function HomepageGroups({ groups, mayEdit }: { groups: HomepageGroupList; mayEdit: boolean }) {
  const active = groups.items.filter((g) => g.isActive).length;
  const full = active >= groups.maxActive;

  return (
    <section className="mt-10 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Named shelves</h2>
        <span className="text-sm text-neutral-600">
          {active} of {groups.maxActive} showing on the homepage
        </span>
      </div>
      <p className="mt-1 text-sm text-neutral-600">
        Extra strips below the main Featured one, each with its own heading. Listings you do not put
        on a shelf stay on the default Featured strip.
      </p>

      {groups.items.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          None yet. The homepage shows the single Featured strip, as it does today.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {groups.items.map((group) => (
            <li key={group.id} className="rounded-lg border border-neutral-200 p-4">
              {mayEdit ? (
                <form action={updateGroupAction.bind(null, group.id)} className="grid gap-2">
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_80px]">
                    <input
                      name="title"
                      defaultValue={group.title}
                      aria-label="Heading"
                      className={INPUT}
                    />
                    <input
                      name="subtitle"
                      defaultValue={group.subtitle ?? ""}
                      placeholder="Optional line under the heading"
                      aria-label="Subtitle"
                      className={INPUT}
                    />
                    <input
                      name="sortOrder"
                      type="number"
                      defaultValue={group.sortOrder}
                      aria-label="Order"
                      className={INPUT}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="isActive" defaultChecked={group.isActive} />
                      Show on the homepage
                    </label>
                    <span className="text-xs text-neutral-500">
                      /{group.slug} &middot;{" "}
                      {group.listingCount === 0
                        ? "no listings, so it will not appear"
                        : `${group.listingCount} listing${group.listingCount === 1 ? "" : "s"}`}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <p className="text-sm font-semibold">{group.title}</p>
              )}

              {mayEdit ? (
                <form action={deleteGroupAction.bind(null, group.id)} className="mt-2">
                  <button
                    type="submit"
                    className="text-xs font-medium text-red-700 underline-offset-2 hover:underline"
                  >
                    Remove this shelf
                  </button>
                  <span className="ml-2 text-xs text-neutral-500">
                    Its listings stay featured and return to the default strip.
                  </span>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {mayEdit ? (
        <form action={createGroupAction} className="mt-5 border-t border-neutral-200 pt-5">
          <h3 className="text-sm font-semibold">Add a shelf</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_80px_auto]">
            <input name="title" placeholder="Best cafes in Madhapur" aria-label="Heading" className={INPUT} />
            <input name="subtitle" placeholder="Optional subtitle" aria-label="Subtitle" className={INPUT} />
            <input name="sortOrder" type="number" defaultValue={0} aria-label="Order" className={INPUT} />
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
            >
              Add
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={!full} disabled={full} />
            Show on the homepage
            {full ? (
              <span className="text-xs text-neutral-500">
                ({groups.maxActive} already showing &mdash; switch one off first)
              </span>
            ) : null}
          </label>
        </form>
      ) : null}
    </section>
  );
}
