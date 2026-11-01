"use client";

import { useCallback, useEffect, useState } from "react";
import type { ListingMedia } from "@/lib/types";

/**
 * The photos and video a business has added.
 *
 * Plain <img> and <video> rather than next/image: the files live in object storage under a host
 * that differs per environment, and the optimiser would need each host registered in next.config.
 * The API caps the file sizes instead, and `width`/`height` come from the file itself, which is
 * what stops the page jumping about as the images load.
 *
 * Clicking a photo opens it full size. A grid of thumbnails that does nothing when clicked is the
 * one thing every visitor tries, and a 400px square is too small to judge a place by.
 */
export function ListingGallery({ media, businessName }: { media: ListingMedia[]; businessName: string }) {
  const photos = media.filter((item) => item.kind === "photo");
  const videos = media.filter((item) => item.kind === "video");

  /** Which photo is open, by index, or null when the viewer is closed. */
  const [open, setOpen] = useState<number | null>(null);

  const close = useCallback(() => setOpen(null), []);
  const step = useCallback(
    (by: number) => setOpen((at) => (at === null ? null : (at + by + photos.length) % photos.length)),
    [photos.length],
  );

  /* Escape closes and the arrows move, because that is what every other image viewer does and a
     visitor should not have to find the button. The listener is only attached while something is
     open, so an ordinary page keeps no key handler. */
  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);

    // The page behind must not scroll while the viewer covers it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close, step]);

  if (photos.length === 0 && videos.length === 0) return null;

  const current = open === null ? null : photos[open];

  return (
    <section
      aria-labelledby="gallery-heading"
      className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_28px_#002a3412] sm:p-7"
    >
      <h2 id="gallery-heading" className="text-xl font-black text-ink">
        Photos
      </h2>

      {photos.length > 0 ? (
        <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <li key={photo.url}>
              <button
                type="button"
                onClick={() => setOpen(index)}
                aria-label={`Open photo ${index + 1} of ${photos.length}`}
                className="group block w-full cursor-zoom-in overflow-hidden rounded-xl border border-line bg-surface focus:ring-2 focus:ring-brand-700 focus:outline-none"
              >
                {/* The alt text names the business: there is nothing stored describing each
                    picture, and an invented description would be worse than none for a screen
                    reader. */}
                <img
                  src={photo.url}
                  alt={businessName}
                  width={photo.width ?? undefined}
                  height={photo.height ?? undefined}
                  loading="lazy"
                  className="aspect-square w-full object-cover transition group-hover:scale-105"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {videos.map((video) => (
        <video
          key={video.url}
          src={video.url}
          controls
          preload="metadata"
          className="mt-4 aspect-video w-full rounded-xl bg-black"
        />
      ))}

      {current ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${businessName}, photo ${open! + 1} of ${photos.length}`}
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute top-4 right-4 rounded-full bg-white/10 px-4 py-2 text-2xl leading-none text-white hover:bg-white/20"
          >
            &times;
          </button>

          {photos.length > 1 ? (
            <>
              {/* stopPropagation: the backdrop closes on click, and these sit on top of it. */}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  step(-1);
                }}
                aria-label="Previous photo"
                className="absolute left-2 rounded-full bg-white/10 px-4 py-3 text-2xl leading-none text-white hover:bg-white/20 sm:left-6"
              >
                &#8249;
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  step(1);
                }}
                aria-label="Next photo"
                className="absolute right-2 rounded-full bg-white/10 px-4 py-3 text-2xl leading-none text-white hover:bg-white/20 sm:right-6"
              >
                &#8250;
              </button>
            </>
          ) : null}

          <img
            src={current.url}
            alt={businessName}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[88vh] max-w-full rounded-lg object-contain"
          />

          {photos.length > 1 ? (
            <p className="absolute bottom-4 text-sm font-bold text-white/80">
              {open! + 1} of {photos.length}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
