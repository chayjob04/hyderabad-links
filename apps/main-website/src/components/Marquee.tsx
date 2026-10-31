import Link from "next/link";
import type { Category } from "@/lib/types";
import { navLabel } from "@/lib/categories";

/**
 * The scrolling strip across the top of the page, as the original site had.
 *
 * The original fed it from a `scrolling_texts` table of editorial announcements. That table does
 * not exist here and inventing one for a decorative strip would be the wrong trade, so this scrolls
 * the subcategories people actually search for. It is the same visual device doing something
 * useful: every item is a link to a real page rather than a sentence nobody can click.
 *
 * The list is rendered twice and the track is animated across exactly half its width, which is what
 * makes the loop seamless — at the moment the first copy scrolls out, the second is in precisely
 * the position the first started from.
 *
 * `aria-hidden` on the duplicate, so a screen reader hears each link once. The animation stops
 * entirely under `prefers-reduced-motion` (see globals.css): a permanently moving strip is a real
 * problem for some readers, not a preference.
 */
export function Marquee({ tree }: { tree: Category[] }) {
  // A flat run of subcategories across different parents, so the strip is varied rather than
  // marching through one section of the directory at a time.
  const items = tree
    .flatMap((parent) => parent.children.slice(0, 3).map((child) => ({ parent, child })))
    .slice(0, 18);

  if (items.length === 0) {
    return null;
  }

  const strip = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-8 px-4" aria-hidden={hidden || undefined}>
      {items.map(({ parent, child }) => (
        <li key={`${parent.slug}-${child.slug}`} className="whitespace-nowrap">
          <Link
            href={`/${parent.slug}/${child.slug}`}
            className="text-[13px] font-bold text-white/90 transition hover:text-white"
            tabIndex={hidden ? -1 : undefined}
          >
            {navLabel(child)}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="overflow-hidden bg-[#050505] py-2.5">
      <div className="marquee-track flex w-max items-center">
        {strip(false)}
        {strip(true)}
      </div>
    </div>
  );
}
