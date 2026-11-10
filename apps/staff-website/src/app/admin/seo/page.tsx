import type { Metadata } from "next";
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
 * Page titles and descriptions.
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
    <main className="mx-auto max-w-3xl px-4 pt-8 pb-12">
      <h1 className="text-2xl font-bold">Page titles and descriptions</h1>
      <p className="mt-2 text-sm text-neutral-600">
        What search engines show, and what appears when a page is shared. Anything left empty keeps
        the text the page works out for itself.
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
      ) : !mayEdit ? (
        <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          Your account can see this page but not change it. It needs the &quot;Edit page titles,
          descriptions and indexing&quot; permission.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-5">
            {result.data.staticPages.map((key) => (
              <MetaForm
                key={key}
                entityType="static"
                entityKey={key}
                label={PAGE_LABELS[key] ?? key}
                existing={existingFor("static", key)}
              />
            ))}
          </div>

          {overrides.length > 0 ? (
            <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold">Overrides on listings, categories and areas</h2>
              <p className="mt-1 text-xs text-neutral-500">
                Set from each item&apos;s own screen. Removing one here restores the default.
              </p>
              <ul className="mt-3 grid gap-2">
                {overrides.map((meta) => (
                  <li
                    key={meta.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-900">
                        {meta.metaTitle ?? "(no title set)"}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {meta.entityType} #{meta.entityId}
                        {meta.noindex ? " · hidden from search" : ""} · {formatWhen(meta.updatedAt)}
                      </p>
                    </div>
                    <form action={clearMetaAction.bind(null, meta.entityType, String(meta.entityId))}>
                      <button
                        type="submit"
                        className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                      >
                        Use the default
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
