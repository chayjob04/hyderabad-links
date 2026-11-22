import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { CategoryThumb } from "@/components/CategoryThumb";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCategories, getPageMeta, getSegments, withPageMeta } from "@/lib/api";
import { absoluteUrl } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const applied = withPageMeta(
    {
      title: "All categories",
      description:
        "Every kind of business listed on Hyderabad Links, from restaurants to electricians.",
    },
    // "static", not "page": page_meta's CHECK allows listing, category, locality and
    // static only, so the "page" lookup that used to be here could never match a row and
    // the admin panel's override for this screen did nothing.
    await getPageMeta("static", "categories"),
  );

  return { ...applied, alternates: { canonical: absoluteUrl("/categories") } };
}

/**
 * Every category and subcategory on one page — the original's `CategoriesList`.
 *
 * The header menu shows the same tree, but only a few at a time behind a hover. A visitor who does
 * not know what we call the thing they want needs to see the whole list at once, and a search
 * engine needs one page that links to every category rather than a menu it may not open.
 *
 * Grouped under its segments since S0030, which is what makes a page this long readable: seventeen
 * cards in one grid is a wall, the same seventeen under Food / Stays / Services is a contents page.
 * A category with no segment is not dropped -- it goes in a group of its own at the end, so an
 * unclassified category is visible to a visitor and obvious to staff rather than missing.
 */
export default async function CategoriesPage() {
  const [tree, segments] = await Promise.all([getCategories(), getSegments()]);

  /* Grouped from the segment each category names, not from the segment's own list, so a category
     and the heading above it can never disagree. Segment order is the API's (sort_order). */
  const groups = segments
    .map((segment) => ({
      slug: segment.slug,
      name: segment.name,
      href: `/${segment.slug}`,
      categories: tree.filter((category) => category.segmentSlug === segment.slug),
    }))
    .filter((group) => group.categories.length > 0);

  const placed = new Set(groups.flatMap((group) => group.categories.map((c) => c.slug)));
  const unplaced = tree.filter((category) => !placed.has(category.slug));
  if (unplaced.length > 0) {
    groups.push({ slug: "", name: "More", href: "", categories: unplaced });
  }

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
          groups.map((group) => (
            <section key={group.slug || "more"} className="mb-10 last:mb-0">
              <h2 className="mb-4 text-xl font-black tracking-tight text-brand-800">
                {group.href ? (
                  <Link href={group.href} className="hover:underline">
                    {group.name}
                  </Link>
                ) : (
                  group.name
                )}
              </h2>

              <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
                {group.categories.map((category) => (
                  <section
                    key={category.slug}
                    className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]"
                  >
                    <Link href={`/${category.slug}`} className="flex items-center gap-3 group">
                      <CategoryThumb slug={category.slug} name={category.name} className="h-11 w-11 shrink-0" />
                      {/* h3, under the segment's h2: the page is a three-tier contents list now,
                          and a screen reader's heading outline should say so. */}
                      <h3 className="text-lg font-black text-brand-800 group-hover:underline">{category.name}</h3>
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
            </section>
          ))
        )}
      </main>
    </>
  );
}
