"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { LocalityCombobox, type LocalityChoice } from "@/components/LocalityCombobox";
import { categoryPath, exactCategory } from "@/lib/categories";
import type { SearchCategory } from "@/lib/types";

type Props = {
  categories: SearchCategory[];
  initialQuery?: string;
};

/**
 * Business + service + location search. The area is chosen in the combobox, either by typing part
 * of a name or by letting the browser share the visitor's location. (IP-based city detection is not
 * needed yet: Hyderabad is the only city.)
 *
 * When the words typed name a known service and an area is chosen, this goes to that area's
 * category page, which is the indexable URL. Anything else - a business name, a stray keyword, no
 * area - goes to /search, where the API matches against listing names, descriptions and services.
 *
 * When the area came from the visitor's own location, the coordinates come with it, so the search
 * can be sorted by real distance rather than only filtered to the area.
 */
/** The entry that means "do not narrow this at all". Matched case-insensitively on submit. */
const ALL_CATEGORIES = "All";

export function SearchBox({ categories, initialQuery = "" }: Props) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [place, setPlace] = useState<LocalityChoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /* "All" leads the list on purpose. Every other entry narrows the search; this one is the way to
     say "show me everything", which the box previously had no word for. */
  const suggestions = [ALL_CATEGORIES, ...new Set(categories.flatMap((c) => [c.name, ...c.terms]))];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const text = query.trim();
    const wantsEverything = text === "" || text.toLowerCase() === ALL_CATEGORIES.toLowerCase();

    /* "Show me everything", typed or picked from the list, and with no area named. An empty search
       used to be refused outright, so there was no way to browse the directory without first
       naming something to look for. /search with no filters lists every business. */
    if (wantsEverything && !place) {
      router.push("/search");
      return;
    }

    /* A category only when the text is exactly one. Anything else is treated as what someone
       typed -- a business name, a service, a word they remember -- and handed to the search, which
       matches names, descriptions and category terms alike. A partial match used to become a
       filter here, which is how searching for a business by name could return nothing because its
       name happened to contain a category word.

       "All" is not a category either, and must not become a keyword: searching for the word "all"
       finds nothing. */
    const category = wantsEverything ? null : exactCategory(text, categories);
    const params = new URLSearchParams();
    if (text && !wantsEverything) params.set("q", text);
    if (category) params.set("category", category.slug);

    if (place?.coords) {
      // The visitor's own location: sort by distance from where they actually are.
      params.set("lat", place.coords.lat.toFixed(5));
      params.set("lng", place.coords.lng.toFixed(5));
      params.set("radiusKm", "10");
      params.set("sort", "distance");
      router.push(`/search?${params.toString()}`);
      return;
    }

    if (category && place) {
      router.push(`/areas/${place.slug}/${category.slug}`);
      return;
    }

    /* Picking a category from the list and pressing Search should land on that category's page,
       not on a search for its name: /shopping/supermarkets-and-groceries is the real page, and
       /search?q=... is a filtered view of the same thing with a worse address.

       Only when the text *is* the category name, which is what picking it from the list leaves
       behind. Typing "supermarket" stays on /search, where the full-text match can do better than
       one category's worth of results. */
    if (category && !place && text.toLowerCase() === category.name.toLowerCase()) {
      router.push(categoryPath(category));
      return;
    }

    if (place) params.set("locality", place.slug);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full rounded-2xl border border-brand-200 bg-white p-3 shadow-[0_12px_40px_#00161c40] sm:p-4"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto]">
        <div>
          <label htmlFor={`${listId}-q`} className="sr-only">
            What are you looking for?
          </label>
          <input
            id={`${listId}-q`}
            list={listId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Enter a business name or category"
            autoComplete="off"
className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-500 caret-slate-900 outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-100"          />
          <datalist id={listId}>
            {suggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </div>
        <LocalityCombobox hideLabel onChange={setPlace} />
        <button
          type="submit"
          className="h-[46px] cursor-pointer rounded-full bg-brand-700 px-7 text-base font-extrabold text-white hover:bg-brand-800"
        >
          Search
        </button>
      </div>
      {message ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {message}
        </p>
      ) : null}
    </form>
  );
}
