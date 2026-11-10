import type { Metadata } from "next";
import { AccessDenied } from "@/components/AccessDenied";
import { PERMISSION_HOMEPAGE, getAdminProfile, getScrollingText } from "@/lib/admin-api";
import { addLineAction, deleteLineAction, toggleLineAction } from "../actions";

export const metadata: Metadata = { title: "Scrolling text" };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

const BUTTON =
  "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50";

const ADD = "rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900";

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
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <h1 className="text-2xl font-bold">Scrolling text</h1>
      <p className="mt-2 text-sm text-neutral-600">
        The moving strip at the top of the public site. With no lines switched on it scrolls the
        directory&rsquo;s own categories instead, so an empty list is safe.
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
          {mayEdit ? (
            <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold">Add a line</h2>
              <form action={addLineAction} className="mt-4 grid gap-3">
                <div>
                  <label className="text-sm font-semibold text-neutral-700" htmlFor="message">
                    What it says
                  </label>
                  <input
                    id="message"
                    name="message"
                    maxLength={200}
                    required
                    placeholder="Ramzan offers across Old City — see the list"
                    className={`mt-1 ${INPUT}`}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <label className="text-sm font-semibold text-neutral-700" htmlFor="url">
                      Where it goes (optional)
                    </label>
                    <input
                      id="url"
                      name="url"
                      maxLength={300}
                      placeholder="/verified"
                      className={`mt-1 ${INPUT}`}
                    />
                    <p className="mt-1 text-xs text-neutral-500">
                      A path on this site, starting with a single &ldquo;/&rdquo;. Links to other
                      sites are refused on purpose. Leave it blank for an announcement with no link.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-neutral-700" htmlFor="sortOrder">
                      Position
                    </label>
                    <input
                      id="sortOrder"
                      name="sortOrder"
                      type="number"
                      defaultValue={lines.length}
                      className={`mt-1 ${INPUT}`}
                    />
                  </div>
                </div>
                <div>
                  <button type="submit" className={ADD}>
                    Add
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">
              Lines{lines.length > 0 ? ` (${live} of ${lines.length} showing)` : ""}
            </h2>

            {lines.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">
                Nothing written yet. The strip is scrolling categories.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-200">
                {lines.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className={line.isActive ? "font-semibold" : "font-semibold text-neutral-400"}>
                        {line.message}
                        {!line.isActive ? (
                          <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-neutral-600">
                            OFF
                          </span>
                        ) : null}
                      </p>
                      <p className="text-sm text-neutral-500">
                        {line.url ?? "No link"} &middot; position {line.sortOrder}
                      </p>
                    </div>

                    {mayEdit ? (
                      <>
                        <form action={toggleLineAction.bind(null, line.id, !line.isActive)}>
                          <button type="submit" className={BUTTON}>
                            {line.isActive ? "Switch off" : "Switch on"}
                          </button>
                        </form>
                        {/* Both offered: switching off is reversible and is the right tool for a
                            seasonal line, while removing is for one that was a mistake. */}
                        <form action={deleteLineAction.bind(null, line.id)}>
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
        </>
      )}
    </main>
  );
}
