"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { LocalityCombobox, type LocalityChoice } from "@/components/LocalityCombobox";
import { categoryPath, resolveCategory } from "@/lib/categories";
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
export function SearchBox({ categories, initialQuery = "" }: Props) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [place, setPlace] = useState<LocalityChoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const suggestions = Array.from(new Set(categories.flatMap((c) => [c.name, ...c.terms])));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (!query.trim() && !place) {
      setMessage("Type what you are looking for, or choose an area.");
      return;
    }

    const category = resolveCategory(query, categories);
    const params = new URLSearchParams();
    const text = query.trim();
    if (text) params.set("q", text);
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
            placeholder="Enter a business category"
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
