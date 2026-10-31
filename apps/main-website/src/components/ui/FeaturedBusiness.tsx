import Image from "next/image";
import Link from "next/link";

type Props = {
  name: string;
  href: string;
  imageUrl: string | null;
};

/**
 * One business on the Featured shelf: a circular picture and its name, and nothing else.
 *
 * Deliberately not `BusinessCard`. That one carries a category, a verified badge and a large
 * rectangular image, which is right for a result you are choosing between but far too heavy for a
 * row of recommendations — eight of them filled the homepage and pushed everything else below the
 * fold. Here the shelf is a glance, so each item is small enough that all eight read as one row.
 *
 * With no picture the first letter stands in, which keeps the circles the same size whether or not
 * a business has uploaded a logo. A half-empty row of different-sized holes looks broken; a letter
 * looks deliberate.
 */
export function FeaturedBusiness({ name, href, imageUrl }: Props) {
  return (
    <Link href={href} className="group flex flex-col items-center gap-3 text-center">
      {/* 64px on the narrowest phones: four 80px circles plus gaps overflowed a 360px screen and
          pushed the page sideways. */}
      <span className="relative block size-16 overflow-hidden rounded-full border border-brand-200 bg-white shadow-[0_6px_16px_#002a3414] transition group-hover:border-brand-700 min-[420px]:size-20 sm:size-24">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            // The rendered circle is 80-96px; 128 covers it on a 2x screen without fetching more.
            sizes="128px"
            className="object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-brand-50 text-2xl font-black text-brand-700">
            {name.trim().charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="line-clamp-2 text-[13px] leading-snug font-bold text-ink group-hover:text-brand-700 sm:text-sm">
        {name}
      </span>
    </Link>
  );
}
