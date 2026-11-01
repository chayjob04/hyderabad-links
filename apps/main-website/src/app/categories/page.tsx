import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { CategoryThumb } from "@/components/CategoryThumb";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCategories, getPageMeta, withPageMeta } from "@/lib/api";

export async function generateMetadata(): Promise<Metadata> {
  return withPageMeta(
    {
      title: "All categories",
      description:
        "Every kind of business listed on Hyderabad Links, from restaurants to electricians.",
    },
    await getPageMeta("page", "categories"),
  );
}

/**
 * Every category and subcategory on one page — the original's `CategoriesList`.
 *
 * The header menu shows the same tree, but only a few at a time behind a hover. A visitor who does
 * not know what we call the thing they want needs to see the whole list at once, and a search
 * engine needs one page that links to every category rather than a menu it may not open.
 */
export default async function CategoriesPage() {
  const tree = await getCategories();

  return (
    <>
      <PageHero
        crumbs={[{ label: "Home", href: "/" }, { label: "All categories" }]}
        title="All categories"
        subtitle={
          tree.length > 0
            ? `${tree.length} ${tree.length === 1 ? "category" : "categories"} across Hyderabad`
            : undefined
        }
      />

      <main className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8">
        {tree.length === 0 ? (
          <EmptyState mark="&#128269;" title="No categories yet">
            <p>Nothing has been published yet. Please try again shortly.</p>
          </EmptyState>
        ) : (
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {tree.map((category) => (
              <section key={category.slug} className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]">
                <Link href={`/${category.slug}`} className="flex items-center gap-3 group">
                  <CategoryThumb slug={category.slug} name={category.name} className="h-11 w-11 shrink-0" />
                  <h2 className="text-lg font-black text-brand-800 group-hover:underline">{category.name}</h2>
                </Link>

                {category.children.length > 0 ? (
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {category.children.map((child) => (
                      <li key={child.slug}>
                        <Link
                          href={`/${category.slug}/${child.slug}`}
                          className="inline-block rounded-full border border-line px-3 py-1.5 text-[13px] font-bold text-brand-700 transition hover:border-brand-700 hover:bg-brand-50"
                        >
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  /* A category with nothing under it is still worth linking: the listings sit
                     directly on it. Saying so beats an empty box. */
                  <p className="mt-3 text-sm text-muted">Browse this category directly.</p>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
