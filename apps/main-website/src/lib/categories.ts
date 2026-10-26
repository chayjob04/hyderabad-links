import type { Category, SearchCategory, SubCategory } from "./types";

export function toSearchCategories(tree: Category[]): SearchCategory[] {
  const children = tree.flatMap((p) =>
    p.children.map((c) => ({ slug: c.slug, name: c.name, terms: c.searchTerms, parentSlug: p.slug })),
  );
  const parents = tree.map((p) => ({ slug: p.slug, name: p.name, terms: [] as string[], parentSlug: null }));
  return [...children, ...parents];
}

/** Where a category's own page lives: /shopping/supermarkets-and-groceries, or /shopping. */
export function categoryPath(category: SearchCategory): string {
  return category.parentSlug ? `/${category.parentSlug}/${category.slug}` : `/${category.slug}`;
}

/** Finds a category (parent or sub-category) by slug. */
export function findCategory(tree: Category[], slug: string): { slug: string; name: string } | null {
  for (const parent of tree) {
    if (parent.slug === slug) return { slug: parent.slug, name: parent.name };
    const child = parent.children.find((c) => c.slug === slug);
    if (child) return { slug: child.slug, name: child.name };
  }
  return null;
}

/** A top-level category by slug, with its subcategories. Null when the slug is not one. */
export function findTopCategory(tree: Category[], slug: string): Category | null {
  return tree.find((parent) => parent.slug === slug) ?? null;
}

/**
 * Resolves /food/cafes: the subcategory *and* the parent it is actually filed under.
 *
 * The parent is checked rather than ignored. `findCategory` above finds "cafes" wherever it sits,
 * which would let /shopping/cafes and /food/cafes both answer with the same page — two URLs for
 * one thing, which is the duplicate-content problem canonical tags exist to clean up after. Null
 * when the pair does not match, and the caller sends a 404.
 */
export function findSubCategory(
  tree: Category[],
  parentSlug: string,
  subSlug: string,
): { parent: Category; sub: SubCategory } | null {
  const parent = findTopCategory(tree, parentSlug);
  const sub = parent?.children.find((c) => c.slug === subSlug);
  return parent && sub ? { parent, sub } : null;
}

/** Turns what the visitor typed ("plumber", "pipe repair") into a category. Exact matches win over partial ones. */
export function resolveCategory(text: string, categories: SearchCategory[]): SearchCategory | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const nameIs = (c: SearchCategory) => c.name.toLowerCase() === q;
  const termIs = (c: SearchCategory) => c.terms.some((t) => t.toLowerCase() === q);
  const nameHas = (c: SearchCategory) => c.name.toLowerCase().includes(q);
  const termHas = (c: SearchCategory) => c.terms.some((t) => t.toLowerCase().includes(q));
  return (
    categories.find(nameIs) ??
    categories.find(termIs) ??
    categories.find(nameHas) ??
    categories.find(termHas) ??
    null
  );
}
