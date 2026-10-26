import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { SearchBox } from "@/components/SearchBox";
import { getCategories, getLocalities } from "@/lib/api";
import { DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";
import { findTopCategory, toSearchCategories } from "@/lib/categories";
import { absoluteUrl } from "@/lib/format";

/**
 * A top-level category: /food, /shopping, /healthcare.
 *
 * It lists its subcategories rather than businesses, because a business is filed under a
 * subcategory — "Food" is a heading, "Cafes" is where listings live.
 *
 * This route sits at the root, so it catches any single unmatched segment. Next.js prefers a
 * static segment over a dynamic one, so /search, /login, /onboarding and /account still win;
 * anything else that is not a category falls through to notFound() below.
 */
type Props = { params: Promise<{ category: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const found = findTopCategory(await getCategories(), category);
  if (!found) return { title: "Not found", robots: { index: false } };

  return {
    title: `${found.name} in ${DEFAULT_CITY_NAME}`,
    description: `Browse ${found.name.toLowerCase()} businesses across ${DEFAULT_CITY_NAME}.`,
    alternates: { canonical: absoluteUrl(`/${found.slug}`) },
    // Nothing to show until it has subcategories; a bare heading is a thin page.
    robots: found.children.length === 0 ? { index: false, follow: true } : undefined,
  };
}

/**
 * An area typed without its prefix — /ameerpet rather than /areas/ameerpet — is the obvious thing
 * for someone to try, and 404 is a poor answer when the page plainly exists. Checked only after
 * the category lookup has failed, so a category always wins if the two ever share a slug, and
 * permanent because /areas/ameerpet is where the page actually lives.
 */
async function redirectIfItIsAnArea(slug: string): Promise<void> {
  const localities = await getLocalities(DEFAULT_CITY);
  if (localities?.some((l) => l.slug === slug)) {
    permanentRedirect(`/areas/${slug}`);
  }
}

export default async function TopCategoryPage({ params }: Props) {
  const { category } = await params;
  const tree = await getCategories();
  const found = findTopCategory(tree, category);
  if (!found) {
    await redirectIfItIsAnArea(category);
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8">
      <SearchBox categories={toSearchCategories(tree)} />

      <h1 className="mt-8 text-2xl font-bold">
        {found.name} in {DEFAULT_CITY_NAME}
      </h1>

      {found.children.length === 0 ? (
        <p className="mt-4 text-neutral-600">Nothing listed under {found.name} yet.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-neutral-500">Pick what you are looking for.</p>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {found.children.map((sub) => (
              <li key={sub.slug}>
                <Link
                  href={`/${found.slug}/${sub.slug}`}
                  className="block rounded-xl border border-neutral-200 bg-white p-4 font-medium shadow-sm hover:border-neutral-400"
                >
                  {sub.name}
                </Link>
              </li>
            ))}
          </ul>

          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "ItemList",
              name: `${found.name} in ${DEFAULT_CITY_NAME}`,
              itemListElement: found.children.map((sub, index) => ({
                "@type": "ListItem",
                position: index + 1,
                url: absoluteUrl(`/${found.slug}/${sub.slug}`),
                name: sub.name,
              })),
            }}
          />
        </>
      )}
    </main>
  );
}
