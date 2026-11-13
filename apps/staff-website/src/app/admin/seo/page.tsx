import type { Metadata } from "next";
import { PageTitle } from "@/components/minia/PageTitle";
import { PERMISSION_SEO, formatWhen, getAdminProfile, getPageMetaList } from "@/lib/admin-api";
import { MetaForm } from "./MetaForm";
import { clearMetaAction } from "./actions";

export const metadata: Metadata = { title: "SEO" };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

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
};

/**
 * Page titles and descriptions, on the original's Minia layout.
 *
 * Static pages get a form each, because there are six of them and they are the ones worth writing
 * by hand. Listings, categories and localities are edited from their own screens — there are
 * hundreds, and a list of every one here would be a worse way to find the one you mean.
 */
export default async function SeoPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, me] = await Promise.all([getPageMetaList(), getAdminProfile()]);
  const mayEdit = me.ok && me.data.permissions.includes(PERMISSION_SEO);

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

      {result.ok && mayEdit && overrides.length > 0 ? (
        <div className="row mb-3">
          <div className="col-xl-9">
            <div className="card">
              <div className="card-body">
                <h4 className="card-title mb-1">Overrides on listings, categories and areas</h4>
                <p className="card-title-desc mb-3">
                  Set from each item&apos;s own screen. Removing one here restores the default.
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
                            {meta.entityType} #{meta.entityId}
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
