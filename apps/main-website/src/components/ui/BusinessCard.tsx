import Link from "next/link";

/**
 * Initials for the circular logo, used for a business that has not uploaded one.
 */
export function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

type Props = {
  name: string;
  categoryName: string;
  href: string;
  /** The uploaded logo or first photo. Null or missing falls back to the monogram. */
  imageUrl?: string | null;
  /** `dark` is the band with the near-black background; `light` is a white section. */
  tone?: "dark" | "light";
  /**
   * True while the business has a paid Verified period. It comes from the API, which computes it
   * from the subscription's expiry on every request, so a lapsed listing loses the tick by itself.
   */
  verified?: boolean;
};

/**
 * The circular-logo business card from the reference. The homepage uses it today and the search
 * results page is meant to adopt it, so the name ribbon and the monogram live here rather than on
 * either page.
 */
export function BusinessCard({ name, categoryName, href, imageUrl, tone = "light", verified = false }: Props) {
  const onDark = tone === "dark";
  return (
    <Link
      href={href}
      className="flex min-w-0 flex-col items-center px-2 pt-2.5 pb-4 text-center transition hover:-translate-y-1.5"
    >
      <div
        className={`relative grid aspect-square w-[min(38vw,170px)] place-items-center rounded-full lg:w-[clamp(145px,17vw,235px)] ${
          onDark
            ? "border-[6px] border-[#14272b] bg-[radial-gradient(circle,#fff_0_61%,#d8e6e8_62%_100%)] shadow-[0_0_0_1px_#21454b,0_0_26px_#0d819333] lg:border-8"
            : "border-[6px] border-white bg-[radial-gradient(circle_at_32%_25%,#fff,#e7f2f3)] shadow-[0_5px_24px_#0b4c5b26] lg:border-8"
        }`}
      >
        {imageUrl ? (
          /* Decorative: the business name is printed directly below the card. */
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="h-[65%] w-[65%] rounded-full border-2 border-brand-200 bg-white object-cover"
          />
        ) : (
          <span
            className={`grid h-[65%] w-[65%] place-items-center rounded-full border-2 border-brand-200 text-3xl font-black tracking-tighter lg:text-[clamp(32px,4vw,54px)] ${
              onDark ? "bg-white text-[#153c44]" : "bg-brand-50 text-brand-700"
            }`}
          >
            {initialsOf(name)}
          </span>
        )}

        {/* The badge sits on the ring rather than next to the name, so it reads at a glance in a
            grid of cards. The label is for screen readers; the tick carries it visually. */}
        {verified ? (
          <span
            className="absolute right-0 bottom-1 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-brand-700 text-white shadow-[0_2px_8px_#0b4c5b59] lg:h-10 lg:w-10"
            title="Verified business"
          >
            <span className="sr-only">Verified business</span>
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 lg:h-5 lg:w-5" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        ) : null}
      </div>
      <h3
        className={`mt-4 text-sm leading-snug font-black lg:mt-5 lg:text-base ${
          onDark ? "text-white" : "text-ink"
        }`}
      >
        {name}
      </h3>
      {/* The ribbon's pointed ends are drawn with borders, as in the reference stylesheet. */}
      <span className="relative mt-2 min-w-[120px] bg-brand-700 px-4 py-1 text-[11px] font-extrabold text-white lg:min-w-[145px] lg:px-5 lg:text-[13px] before:absolute before:top-0 before:-left-2.5 before:h-0 before:w-0 before:border-y-[14px] before:border-l-[10px] before:border-y-brand-700 before:border-l-transparent before:content-[''] after:absolute after:top-0 after:-right-2.5 after:h-0 after:w-0 after:border-y-[14px] after:border-r-[10px] after:border-y-brand-700 after:border-r-transparent after:content-['']">
        {categoryName}
      </span>
    </Link>
  );
}
