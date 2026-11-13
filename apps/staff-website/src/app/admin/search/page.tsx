import type { Metadata } from "next";
import { PageTitle } from "@/components/minia/PageTitle";
import { PERMISSION_TAXONOMY, getAdminProfile, getSearchTuning } from "@/lib/admin-api";
import {
  addPlaceholderAction,
  addSynonymAction,
  deletePlaceholderAction,
  deleteSynonymAction,
} from "./actions";

export const metadata: Metadata = { title: "Search" };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

/**
 * Tuning what a search word means, and what the search box says.
 *
 * Both lists fall back to today's behaviour when empty: no synonyms means a search runs exactly as
 * it does now, and no placeholders means the website keeps its own wording. Clearing everything is
 * therefore safe rather than leaving visitors with an empty search box.
 *
 * Two cards, one per list, each with its add row above a table of what is already there — the
 * same shape the original gives its Manage SearchKeys and Manage PlaceholderText screens.
 */
export default async function SearchTuningPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me] = await Promise.all([getSearchTuning(), getAdminProfile()]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_TAXONOMY);

  return (
    <>
      <PageTitle title="Search" breadcrumb={[{ label: "Configurations" }, { label: "Search" }]} />

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
                <h4 className="card-title mb-1">Word meanings</h4>
                <p className="card-title-desc mb-3">
                  When somebody types the first word, search for the second instead. Typo tolerance
                  still applies afterwards, so a misspelling of the first word works too.
                </p>

                {mayEdit ? (
                  <form action={addSynonymAction} className="row g-2 align-items-end mb-3">
                    <div className="col-sm-5">
                      <label htmlFor="term" className="form-label">
                        What people type
                      </label>
                      <input id="term" name="term" placeholder="medical shop" className="form-control" />
                    </div>
                    <div className="col-sm-5">
                      <label htmlFor="mapsTo" className="form-label">
                        What to search for
                      </label>
                      <input id="mapsTo" name="mapsTo" placeholder="pharmacies" className="form-control" />
                    </div>
                    <div className="col-sm-2">
                      <button type="submit" className="btn btn-primary w-100">
                        Add
                      </button>
                    </div>
                  </form>
                ) : null}

                {result.data.synonyms.length === 0 ? (
                  <p className="text-muted font-size-13 mb-0">
                    None yet. Searches run exactly as they do now.
                  </p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Typed</th>
                          <th scope="col">Searched</th>
                          {mayEdit ? (
                            <th scope="col" className="text-end">
                              Action
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.synonyms.map((synonym) => (
                          <tr key={synonym.id}>
                            <td className="py-3 fw-semibold">{synonym.term}</td>
                            <td className="py-3 text-muted">{synonym.mapsTo}</td>
                            {mayEdit ? (
                              <td className="py-3 text-end">
                                <form action={deleteSynonymAction.bind(null, synonym.id)}>
                                  <button type="submit" className="btn btn-sm btn-outline-secondary">
                                    Remove
                                  </button>
                                </form>
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
                <h4 className="card-title mb-1">Search box text</h4>
                <p className="card-title-desc mb-3">
                  The grey hint inside the search box. With none set, the website uses its own
                  wording.
                </p>

                {mayEdit ? (
                  <form action={addPlaceholderAction} className="row g-2 align-items-end mb-3">
                    <div className="col-sm-7">
                      <label htmlFor="text" className="form-label">
                        Placeholder text
                      </label>
                      <input
                        id="text"
                        name="text"
                        placeholder="Plumbers, dentists, biryani"
                        className="form-control"
                      />
                    </div>
                    <div className="col-sm-3">
                      <label htmlFor="sortOrder" className="form-label">
                        Order
                      </label>
                      <input
                        id="sortOrder"
                        name="sortOrder"
                        type="number"
                        defaultValue={0}
                        className="form-control"
                      />
                    </div>
                    <div className="col-sm-2">
                      <button type="submit" className="btn btn-primary w-100">
                        Add
                      </button>
                    </div>
                  </form>
                ) : null}

                {result.data.placeholders.length === 0 ? (
                  <p className="text-muted font-size-13 mb-0">
                    None set, so the built-in text is used.
                  </p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Text</th>
                          {mayEdit ? (
                            <th scope="col" className="text-end">
                              Action
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.placeholders.map((placeholder) => (
                          <tr key={placeholder.id}>
                            <td className="py-3">{placeholder.text}</td>
                            {mayEdit ? (
                              <td className="py-3 text-end">
                                <form action={deletePlaceholderAction.bind(null, placeholder.id)}>
                                  <button type="submit" className="btn btn-sm btn-outline-secondary">
                                    Remove
                                  </button>
                                </form>
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

          {!mayEdit ? (
            <div className="col-12">
              <div className="alert alert-light border mb-0 font-size-13">
                Your account can see this page but not change it. It needs the taxonomy permission.
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
