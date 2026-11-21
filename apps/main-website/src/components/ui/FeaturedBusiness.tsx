"use client";

import Link from "next/link";
import { useState } from "react";

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
 *
 * <b>A plain `img`, not `next/image`, and that is the fix for a real outage.</b> Listing media is
 * served from whatever bucket `Media__PublicBaseUrl` names — today an `r2.dev` subdomain, tomorrow
 * `media.hyderabadlinks.com` — and the optimizer refuses any host that is not named in
 * `images.remotePatterns`. Nothing named it, so every logo and photo on the homepage shelves came
 * back **400** from `/_next/image` and the circles rendered empty, while the same files loaded
 * perfectly on the search and listing pages, which had always used a plain `img`. Allow-listing the
 * host would have fixed today's bucket and broken again at the next one; this cannot, and it is
 * what the other five components that show listing media already do.
 *
 * The cost is honest: no automatic resizing. These circles are 64-96px, and the configuration this
 * replaces was asking the optimizer for a 3840px-wide copy of them anyway.
 */
export function FeaturedBusiness({ name, href, imageUrl }: Props) {
  /* Which URL failed, rather than a bare "it failed": the component can be reused for a different
     business as a shelf re-renders, and a boolean would carry one listing's broken image over and
     hide the next one's good logo. */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = imageUrl !== null && imageUrl !== failedUrl;

  return (
    <Link href={href} className="group flex flex-col items-center gap-3 text-center">
      {/* 64px on the narrowest phones: four 80px circles plus gaps overflowed a 360px screen and
          pushed the page sideways. */}
      <span className="relative block size-16 overflow-hidden rounded-full border border-brand-200 bg-white shadow-[0_6px_16px_#002a3414] transition group-hover:border-brand-700 min-[420px]:size-20 sm:size-24">
        {showImage ? (
          /* `absolute inset-0 size-full` is what `fill` expanded to, against the same `relative`
             parent, so the circle is laid out exactly as before.

             onError is the reason this file is a client component. It turns a picture that cannot
             be fetched into the same monogram a business with no logo gets, so the next time a
             media host changes the shelves degrade to letters instead of to holes — which is the
             failure that went unnoticed here. */
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            onError={() => setFailedUrl(imageUrl)}
            className="absolute inset-0 size-full object-cover"
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
