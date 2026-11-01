import Link from "next/link";
import type { Category, ScrollingTextLine } from "@/lib/types";
import { navLabel } from "@/lib/categories";

/**
 * The scrolling strip across the top of the page, as the original site had.
 *
 * The original fed it from a `scrolling_texts` table of editorial announcements, and since S0025 so
 * does this: staff write the lines on the admin's Scrolling text screen. Until somebody writes one,
 * the strip falls back to scrolling the subcategories people actually search for — the same visual
 * device doing something useful rather than an empty black band.
 *
 * A curated line may have no link, which is a legitimate announcement, so an item is a <span> in
 * that case rather than a link to nowhere. The link is only ever a site-relative path: the API and
 * a database CHECK both refuse anything else (S0025), because this text is written in an admin
 * panel and rendered on the public site, which is the exact shape of an open redirect.
 *
 * The list is rendered twice and the track is animated across exactly half its width, which is what
 * makes the loop seamless — at the moment the first copy scrolls out, the second is in precisely
 * the position the first started from.
 *
 * `aria-hidden` on the duplicate, so a screen reader hears each item once. The animation stops
 * entirely under `prefers-reduced-motion` (see globals.css): a permanently moving strip is a real
 * problem for some readers, not a preference.
 */
type Item = { key: string; label: string; href: string | null };

export function Marquee({ tree, lines = [] }: { tree: Category[]; lines?: ScrollingTextLine[] }) {
  const items: Item[] =
    lines.length > 0 ?
      lines.map((line, index) => ({
        key: `line-${index}`,
        label: line.message,
        href: line.url,
      }))
      // A flat run of subcategories across different parents, so the strip is varied rather than
      // marching through one section of the directory at a time.
    : tree
        .flatMap((parent) =>
          parent.children.slice(0, 3).map((child) => ({
            key: `${parent.slug}-${child.slug}`,
            label: navLabel(child),
            href: `/${parent.slug}/${child.slug}`,
          })),
        )
        .slice(0, 18);

  if (items.length === 0) {
    return null;
  }

  const strip = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-8 px-4" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <li key={item.key} className="whitespace-nowrap">
          {item.href ? (
            <Link
              href={item.href}
              className="text-[13px] font-bold text-white/90 transition hover:text-white"
              tabIndex={hidden ? -1 : undefined}
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-[13px] font-bold text-white/90">{item.label}</span>
          )}
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
