import { CategoryThumb } from "@/components/CategoryThumb";
import { PageHero } from "@/components/PageHero";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { SearchBox } from "@/components/SearchBox";
import { getCategories, getLocalities, getPageMeta, withPageMeta } from "@/lib/api";
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

  const applied = withPageMeta(
    {
      title: `${found.name} in ${DEFAULT_CITY_NAME}`,
      description: `Browse ${found.name.toLowerCase()} businesses across ${DEFAULT_CITY_NAME}.`,
    },
    await getPageMeta("category", found.slug),
  );

  return {
    ...applied,
    alternates: { canonical: absoluteUrl(`/${found.slug}`) },
    // Nothing to show until it has subcategories; a bare heading is a thin page. An override that
    // sets noindex wins, because somebody decided it deliberately.
    robots: applied.robots ?? (found.children.length === 0 ? { index: false, follow: true } : undefined),
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
    <>
      <PageHero
        crumbs={[{ label: "Home", href: "/" }, { label: found.name }]}
        title={
          <>
            {found.name} in <span className="text-[#42d0dc]">{DEFAULT_CITY_NAME}</span>
          </>
        }
        subtitle={
          found.children.length === 0
            ? undefined
            : `${found.children.length} kinds of ${found.name.toLowerCase()} to choose from`
        }
      />

      <main className="mx-auto max-w-5xl px-5 pt-8 pb-16 sm:px-8">
        <SearchBox categories={toSearchCategories(tree)} />

      {found.children.length === 0 ? (
        <p className="mt-4 text-neutral-600">Nothing listed under {found.name} yet.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-neutral-500">Pick what you are looking for.</p>

          {/* Each card carries the category's picture where the original site had one, and its
              drawn icon where it does not — see CategoryThumb. The layout is the same either way,
              so filling the image map in later changes nothing structural. */}
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {found.children.map((sub) => (
              <li key={sub.slug}>
                <Link
                  href={`/${found.slug}/${sub.slug}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-white p-3 font-bold text-ink shadow-[0_6px_18px_#002a340a] transition hover:border-brand-700 hover:shadow-[0_10px_24px_#002a3414]"
                >
                  <CategoryThumb slug={sub.slug} name={sub.name} className="size-14 shrink-0" />
                  <span className="min-w-0">{sub.name}</span>
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
    </>
  );
}
