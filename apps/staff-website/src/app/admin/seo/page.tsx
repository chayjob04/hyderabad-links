import type { Metadata } from "next";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_SEO,
  formatWhen,
  getAdminCategories,
  getAdminLocalities,
  getAdminProfile,
  getPageMetaList,
  searchSeoListings,
  type AdminCategory,
} from "@/lib/admin-api";
import { MetaForm } from "./MetaForm";
import { clearMetaAction } from "./actions";

export const metadata: Metadata = { title: "SEO" };

type Props = {
  searchParams: Promise<{
    done?: string;
    error?: string;
    category?: string;
    locality?: string;
    /** What was typed into the listing search box. */
    q?: string;
    /** The id of the listing chosen from those results. */
    listing?: string;
  }>;
};

/** Friendly names for the fixed set of static pages the API accepts. */
const PAGE_LABELS: Record<string, string> = {
  home: "Home page",
  search: "Search results",
  terms: "Terms of use",
  privacy: "Privacy policy",
  help: "Help & feedback",
  blog: "Blog index",
  about: "About us",
  pricing: "Pricing",
  categories: "All categories",
  areas: "Areas index",
  trending: "Trending businesses",
  verified: "Verified businesses",
};

/**
 * Page titles and descriptions, on the original's Minia layout.
 *
 * Static pages get a form each: there are twelve of them and they are the ones worth writing by
 * hand.
 *
 * Categories and areas are chosen first and then edited, rather than listed. There are a few
 * hundred of them, so a form each would bury the twelve above, and this screen used to say they
 * were "edited from their own screens" — which was not true of any screen in the app. The API
 * accepted a category, area or listing override and the public site read one; nothing could create
 * one. Picking from a list of the real ones also means the id sent to the API is always an id that
 * exists, which typing one into a box would not guarantee.
 *
 * Listings are searched rather than listed, for the same reason: there are thousands of them, so
 * the dropdown is the wrong control and was why this entity type had no panel at all -- although
 * the table, the API and the public page have supported it since S0021. Typing a name (or an id,
 * which is what the override list below shows for a listing it cannot name) narrows to at most
 * twenty, and the id that reaches the API is one that came back from it.
 */
type Pick = { id: number; label: string; path: string };

/**
 * The category tree as a flat list, parents before their children, each labelled the way the site
 * reads and carrying the path it lives at. A subcategory's page is `/parent/child`, which is why
 * the parent's slug travels with it.
 */
function flatten(categories: AdminCategory[]): Pick[] {
  const out: Pick[] = [];
  for (const parent of categories) {
    out.push({ id: parent.id, label: parent.name, path: `/${parent.slug}` });
    for (const child of parent.children) {
      out.push({
        id: child.id,
        label: `${parent.name} / ${child.name}`,
        path: `/${parent.slug}/${child.slug}`,
      });
    }
  }
  return out;
}

export default async function SeoPage({ searchParams }: Props) {
  const {
    done,
    error,
    category: pickedCategory,
    locality: pickedLocality,
    q: listingQuery,
    listing: pickedListing,
  } = await searchParams;

  /* The listing search runs on the server, with the typed text in the address, so a result is
     linkable and the page stays a server component. `pickedListing` is searched for by id, which is
     also how a chosen listing survives a reload. */
  const search = (listingQuery ?? "").trim();
  const [result, me, categories, localities, listingResults, pickedResults] = await Promise.all([
    getPageMetaList(),
    getAdminProfile(),
    getAdminCategories(),
    getAdminLocalities(),
    search.length >= 2 ? searchSeoListings(search) : Promise.resolve(null),
    pickedListing ? searchSeoListings(pickedListing) : Promise.resolve(null),
  ]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_SEO);

  /* The category tree flattened into "Parent / Child", with the public path each one lives at, so
     the dropdown reads the way the site does and the save can refresh the right page. */
  const flatCategories = categories.ok ? flatten(categories.data) : [];
  const flatLocalities = localities.ok
    ? localities.data.map((l) => ({ id: l.id, label: l.name, path: `/areas/${l.slug}` }))
    : [];

  /* Which parameter matched decides the kind, not which one is merely present: an address
     carrying a category id that no longer exists alongside a real area id would otherwise render
     the area's id under the category's entity type and write the override onto the wrong row. */
  const asCategory = flatCategories.find((c) => String(c.id) === pickedCategory);
  const asLocality = flatLocalities.find((l) => String(l.id) === pickedLocality);
  /* A listing is only "chosen" when the API returned it under exactly that id: the id in the
     address is as untrusted as any other parameter, and this is what stops a title being written
     onto a row that does not exist. */
  const asListingRow =
    pickedResults?.ok && pickedListing
      ? pickedResults.data.items.find((item) => String(item.id) === pickedListing)
      : undefined;
  /* Only once it has a public page. A listing with no primary category has no page for a title to
     be about, so the form is not offered -- the panel says what to fix instead. */
  const asListing =
    asListingRow && asListingRow.url
      ? { id: asListingRow.id, label: asListingRow.name, path: asListingRow.url }
      : undefined;
  const chosen = asCategory ?? asLocality ?? asListing;
  const chosenType = asCategory ? "category" : asLocality ? "locality" : asListing ? "listing" : null;

  /** An existing override on a category or area, which is addressed by id rather than by key. */
  const existingForEntity = (entityType: string, id: number) =>
    result.ok
      ? result.data.items.find((m) => m.entityType === entityType && m.entityId === id)
      : undefined;

  /** The name behind "category #12" in the list below, when we have it. */
  const nameFor = (entityType: string, id: number) =>
    entityType === "category"
      ? flatCategories.find((c) => c.id === id)?.label
      : entityType === "locality"
        ? flatLocalities.find((l) => l.id === id)?.label
        : entityType === "listing"
          ? // Named when this page happens to have it, from the search or the chosen listing.
            (listingResults?.ok ? listingResults.data.items : []).find((item) => item.id === id)?.name ??
            (pickedResults?.ok ? pickedResults.data.items : []).find((item) => item.id === id)?.name
          : undefined;

  const existingFor = (entityType: string, key: string) =>
    result.ok
      ? result.data.items.find((m) => m.entityType === entityType && m.pageKey === key)
      : undefined;

  const overrides = result.ok ? result.data.items.filter((m) => m.entityType !== "static") : [];

  return (
    <>
      <PageTitle title="SEO Home" breadcrumb={[{ label: "SEO" }, { label: "Titles and descriptions" }]} />

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

      <div className="row mb-3">
        <div className="col-xl-9">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-1">Page titles and descriptions</h4>
              <p className="card-title-desc mb-3">
                What search engines show, and what appears when a page is shared. Anything left
                empty keeps the text the page works out for itself.
              </p>

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.message}
                </div>
              ) : !mayEdit ? (
                <div className="alert alert-light border mb-0 font-size-13">
                  Your account can see this page but not change it. It needs the &quot;Edit page
                  titles, descriptions and indexing&quot; permission.
                </div>
              ) : (
                result.data.staticPages.map((key) => (
                  <MetaForm
                    key={key}
                    entityType="static"
                    entityKey={key}
                    label={PAGE_LABELS[key] ?? key}
                    existing={existingFor("static", key)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {result.ok && mayEdit ? (
        <div className="row mb-3">
          <div className="col-xl-9">
            <div className="card">
              <div className="card-body">
                <h4 className="card-title mb-1">A listing, category or area page</h4>
                <p className="card-title-desc mb-3">
                  Pick the one you want and its own title and description appear below. Anything
                  left empty keeps what that page works out for itself.
                </p>

                {/* Plain GET forms: choosing reloads this screen with the choice in the address,
                    which keeps the whole page a server component and makes the choice linkable. */}
                <div className="row g-3 mb-3">
                  <div className="col-md-6">
                    <form method="get" action="/admin/seo" className="d-flex gap-2 align-items-end">
                      <div className="flex-grow-1">
                        <label htmlFor="pick-category" className="form-label">
                          Category
                        </label>
                        <select
                          id="pick-category"
                          name="category"
                          className="form-select"
                          defaultValue={pickedCategory ?? ""}
                        >
                          <option value="">Choose a category…</option>
                          {flatCategories.map((c) => (
                            <option key={c.id} value={String(c.id)}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" className="btn btn-outline-secondary">
                        Open
                      </button>
                    </form>
                  </div>

                  <div className="col-md-6">
                    <form method="get" action="/admin/seo" className="d-flex gap-2 align-items-end">
                      <div className="flex-grow-1">
                        <label htmlFor="pick-locality" className="form-label">
                          Area
                        </label>
                        <select
                          id="pick-locality"
                          name="locality"
                          className="form-select"
                          defaultValue={pickedLocality ?? ""}
                        >
                          <option value="">Choose an area…</option>
                          {flatLocalities.map((l) => (
                            <option key={l.id} value={String(l.id)}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" className="btn btn-outline-secondary">
                        Open
                      </button>
                    </form>
                  </div>
                </div>

                {/* A listing is found by typing, not chosen from a list: there are thousands.
                    Two characters is the shortest search worth running, and at most twenty come
                    back -- past that the answer is to type more, which the panel says. */}
                <form method="get" action="/admin/seo" className="d-flex gap-2 align-items-end mb-3">
                  <div className="flex-grow-1">
                    <label htmlFor="pick-listing" className="form-label">
                      Listing
                    </label>
                    <input
                      id="pick-listing"
                      name="q"
                      type="search"
                      className="form-control"
                      placeholder="Business name, or its id"
                      defaultValue={search}
                    />
                  </div>
                  <button type="submit" className="btn btn-outline-secondary">
                    Search
                  </button>
                </form>

                {listingResults && !listingResults.ok ? (
                  <p role="alert" className="text-danger font-size-13">
                    {listingResults.message}
                  </p>
                ) : null}

                {listingResults?.ok ? (
                  listingResults.data.items.length === 0 ? (
                    <p className="text-muted font-size-13">
                      Nothing matches &ldquo;{search}&rdquo;.
                    </p>
                  ) : (
                    <>
                      <div className="table-responsive mb-3">
                        <table className="table table-sm align-middle mb-0">
                          <tbody>
                            {listingResults.data.items.map((item) => (
                              <tr key={item.id}>
                                <td>
                                  <span className="fw-medium">{item.name}</span>
                                  <span className="text-muted font-size-12">
                                    {" "}
                                    &middot; {item.categoryName ?? "no category"} &middot;{" "}
                                    {item.localityName} &middot; {item.status}
                                  </span>
                                  {item.hasOverride ? (
                                    <span className="badge bg-info ms-2">has a title</span>
                                  ) : null}
                                </td>
                                <td className="text-end">
                                  {item.url ? (
                                    <a
                                      href={`/admin/seo?q=${encodeURIComponent(search)}&listing=${item.id}`}
                                      className="btn btn-sm btn-outline-secondary"
                                    >
                                      Open
                                    </a>
                                  ) : (
                                    // No primary category, so no public page to write a title for.
                                    <span className="text-muted font-size-12">no public page yet</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {listingResults.data.truncated ? (
                        <p className="text-muted font-size-12">
                          Showing the first {listingResults.data.items.length} of{" "}
                          {listingResults.data.total}. Type more of the name to narrow it.
                        </p>
                      ) : null}
                    </>
                  )
                ) : null}

                {chosen && chosenType ? (
                  <MetaForm
                    key={`${chosenType}-${chosen.id}`}
                    entityType={chosenType}
                    entityKey={String(chosen.id)}
                    label={`${chosen.label} — ${chosen.path}`}
                    existing={existingForEntity(chosenType, chosen.id)}
                    publicPath={chosen.path}
                  />
                ) : (
                  <p className="text-muted font-size-13 mb-0">
                    Nothing chosen yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {result.ok && mayEdit && overrides.length > 0 ? (
        <div className="row mb-3">
          <div className="col-xl-9">
            <div className="card">
              <div className="card-body">
                <h4 className="card-title mb-1">Overrides on listings, categories and areas</h4>
                <p className="card-title-desc mb-3">
                  Every override that is not one of the pages above. Removing one restores the
                  default that page works out for itself.
                </p>

                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col">Title</th>
                        <th scope="col">Applies to</th>
                        <th scope="col">Updated</th>
                        <th scope="col" className="text-end">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {overrides.map((meta) => (
                        <tr key={meta.id}>
                          <td className="fw-semibold">{meta.metaTitle ?? "(no title set)"}</td>
                          <td className="text-muted">
                            {nameFor(meta.entityType, meta.entityId) ??
                              `${meta.entityType} #${meta.entityId}`}
                            {meta.noindex ? (
                              <span className="badge bg-secondary-subtle text-secondary ms-2">
                                hidden from search
                              </span>
                            ) : null}
                          </td>
                          <td className="text-muted font-size-13">{formatWhen(meta.updatedAt)}</td>
                          <td className="text-end">
                            <form action={clearMetaAction.bind(null, meta.entityType, String(meta.entityId))}>
                              <button type="submit" className="btn btn-sm btn-outline-secondary">
                                Use the default
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
