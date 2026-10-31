import type { ListingAttribute } from "@/lib/types";

/** The order the lists read in, and what each is called. Offerings first: it is what they do. */
const SECTIONS: { kind: string; heading: string }[] = [
  { kind: "offering", heading: "What we offer" },
  { kind: "amenity", heading: "Good to know" },
  { kind: "language", heading: "Languages spoken" },
];

/**
 * What a business offers, what it has on site and what languages it speaks.
 *
 * Rendered as chips rather than bullet lists: these are short labels scanned at a glance, and a
 * visitor comparing two plumbers wants to see "Telugu" in half a second, not read a paragraph.
 *
 * A section with nothing in it is left out entirely rather than shown as an empty heading, which
 * is the rule every shelf on this site follows.
 */
export function ListingAttributes({ attributes }: { attributes: ListingAttribute[] }) {
  const present = SECTIONS.map((section) => ({
    ...section,
    labels: attributes.filter((a) => a.kind === section.kind).map((a) => a.label),
  })).filter((section) => section.labels.length > 0);

  if (present.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-line bg-white p-5 shadow-[0_8px_22px_#002a340b]">
      <div className="grid gap-5">
        {present.map((section) => (
          <div key={section.kind}>
            <h2 className="text-sm font-black tracking-wide text-muted uppercase">{section.heading}</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {section.labels.map((label) => (
                <li
                  key={label}
                  className="rounded-full border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-[13px] font-bold text-brand-800"
                >
                  {label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
