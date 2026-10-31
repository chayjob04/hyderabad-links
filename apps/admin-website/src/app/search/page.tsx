import type { Metadata } from "next";
import { PERMISSION_TAXONOMY, getAdminProfile, getSearchTuning } from "@/lib/admin-api";
import {
  addPlaceholderAction,
  addSynonymAction,
  deletePlaceholderAction,
  deleteSynonymAction,
} from "./actions";

export const metadata: Metadata = { title: "Search" };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

const REMOVE =
  "rounded-lg border border-neutral-300 bg-white px-4 py-1.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50";

const ADD = "rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900";

/**
 * Tuning what a search word means, and what the search box says.
 *
 * Both lists fall back to today's behaviour when empty: no synonyms means a search runs exactly as
 * it does now, and no placeholders means the website keeps its own wording. Clearing everything is
 * therefore safe rather than leaving visitors with an empty search box.
 */
export default async function SearchTuningPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me] = await Promise.all([getSearchTuning(), getAdminProfile()]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_TAXONOMY);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <h1 className="text-2xl font-bold">Search</h1>
      <p className="mt-2 text-sm text-neutral-600">
        What a word should mean, and what the search box suggests. Changes apply to the next search
        &mdash; nothing needs deploying.
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
            <h2 className="text-base font-semibold">Word meanings</h2>
            <p className="mt-1 text-sm text-neutral-600">
              When somebody types the first word, search for the second instead. Typo tolerance
              still applies afterwards, so a misspelling of the first word works too.
            </p>

            {mayEdit ? (
              <form action={addSynonymAction} className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input name="term" placeholder="medical shop" aria-label="What people type" className={INPUT} />
                <input name="mapsTo" placeholder="pharmacies" aria-label="What to search for" className={INPUT} />
                <button type="submit" className={ADD}>
                  Add
                </button>
              </form>
            ) : null}

            {result.data.synonyms.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">None yet. Searches run exactly as they do now.</p>
            ) : (
              <ul className="mt-4 grid gap-2">
                {result.data.synonyms.map((synonym) => (
                  <li
                    key={synonym.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3"
                  >
                    <span className="text-sm">
                      <strong>{synonym.term}</strong>
                      <span aria-hidden="true" className="mx-2 text-neutral-400">
                        &rarr;
                      </span>
                      {synonym.mapsTo}
                    </span>
                    {mayEdit ? (
                      <form action={deleteSynonymAction.bind(null, synonym.id)}>
                        <button type="submit" className={REMOVE}>
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">Search box text</h2>
            <p className="mt-1 text-sm text-neutral-600">
              The grey hint inside the search box. With none set, the website uses its own wording.
            </p>

            {mayEdit ? (
              <form action={addPlaceholderAction} className="mt-4 grid gap-2 sm:grid-cols-[1fr_90px_auto]">
                <input
                  name="text"
                  placeholder="Plumbers, dentists, biryani"
                  aria-label="Placeholder text"
                  className={INPUT}
                />
                <input name="sortOrder" type="number" defaultValue={0} aria-label="Order" className={INPUT} />
                <button type="submit" className={ADD}>
                  Add
                </button>
              </form>
            ) : null}

            {result.data.placeholders.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">None set, so the built-in text is used.</p>
            ) : (
              <ul className="mt-4 grid gap-2">
                {result.data.placeholders.map((placeholder) => (
                  <li
                    key={placeholder.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3"
                  >
                    <span className="text-sm">{placeholder.text}</span>
                    {mayEdit ? (
                      <form action={deletePlaceholderAction.bind(null, placeholder.id)}>
                        <button type="submit" className={REMOVE}>
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!mayEdit ? (
            <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
              Your account can see this page but not change it. It needs the taxonomy permission.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
