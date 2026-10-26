import Link from "next/link";

type Item = { slug: string; name: string };

/**
 * One card in the "most searched" grid: a teal cap with the parent category's name, then its
 * sub-categories as links to their own pages. Used by the homepage today and by any later browse
 * page.
 *
 * `parentSlug` is needed because a sub-category page lives under its parent (/food/cafes): the
 * sub-category slug alone does not say where the page is.
 */
export function CategoryCard({
  title,
  parentSlug,
  items,
}: {
  title: string;
  parentSlug: string;
  items: Item[];
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-white shadow-[0_8px_24px_#12313a12] transition hover:-translate-y-1 hover:shadow-[0_15px_32px_#12313a1b]">
      <h3 className="grid min-h-[70px] place-items-center bg-brand-700 px-4 py-4 text-center text-base font-black text-white sm:text-lg">
        {title}
      </h3>
      <div className="px-5 py-3">
        {items.map((item) => (
          <Link
            key={item.slug}
            href={`/${parentSlug}/${item.slug}`}
            className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm font-bold text-brand-800 last:border-b-0 hover:text-brand-500"
          >
            <span>{item.name}</span>
            <span aria-hidden="true" className="text-xl leading-none text-brand-700">
              &rsaquo;
            </span>
          </Link>
        ))}
      </div>
    </article>
  );
}
