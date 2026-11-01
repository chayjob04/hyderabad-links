import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { getLocalities, getPageMeta, withPageMeta } from "@/lib/api";
import { DEFAULT_CITY, DEFAULT_CITY_NAME } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  return withPageMeta(
    {
      title: `Areas of ${DEFAULT_CITY_NAME}`,
      description: `Every area of ${DEFAULT_CITY_NAME} covered by Hyderabad Links. Find businesses near you.`,
    },
    await getPageMeta("page", "areas"),
  );
}

/**
 * Every locality on one page — the original's `Area/Index`.
 *
 * This site is location-first, so the list of areas is as important as the list of categories, and
 * until now there was no page that held all of them: `/areas/[locality]` existed with nothing
 * linking to it but a search. Grouping by first letter rather than listing 200 names in one column
 * is what makes a long list usable without a filter box.
 */
export default async function AreasPage() {
  const localities = (await getLocalities(DEFAULT_CITY)) ?? [];

  /* Grouped by initial, in one pass. A Map keeps insertion order, and the API already returns
     them alphabetically, so the groups come out in order without a second sort. */
  const groups = new Map<string, typeof localities>();
  for (const locality of localities) {
    const letter = locality.name.charAt(0).toUpperCase();
    const bucket = groups.get(letter);
    if (bucket) bucket.push(locality);
    else groups.set(letter, [locality]);
  }

  return (
    <>
      <PageHero
        crumbs={[{ label: "Home", href: "/" }, { label: "Areas" }]}
        title={`Areas of ${DEFAULT_CITY_NAME}`}
        subtitle={
          localities.length > 0
            ? `${localities.length} ${localities.length === 1 ? "area" : "areas"} covered`
            : undefined
        }
      />

      <main className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8">
        {localities.length === 0 ? (
          <EmptyState mark="&#128205;" title="No areas yet">
            <p>Nothing has been published yet. Please try again shortly.</p>
          </EmptyState>
        ) : (
          <div className="grid gap-8">
            {[...groups].map(([letter, items]) => (
              <section key={letter}>
                <h2 className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-700 text-base font-black text-white">
                  {letter}
                </h2>
                <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                  {items.map((locality) => (
                    <li key={locality.slug}>
                      <Link
                        href={`/areas/${locality.slug}`}
                        className="block border-b border-line py-2 text-sm font-bold text-brand-700 hover:text-brand-900 hover:underline"
                      >
                        {locality.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
