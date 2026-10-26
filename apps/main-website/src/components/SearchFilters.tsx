import { LocalityCombobox } from "@/components/LocalityCombobox";
import type { Category, SearchCriteria } from "@/lib/types";

type Props = {
  criteria: SearchCriteria;
  categories: Category[];
  /** The name of the area already filtered on, so the picker can show it. Null when there is none. */
  localityName: string | null;
};

const fieldClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base text-ink outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

const labelClass = "block text-xs font-black tracking-[0.12em] text-muted uppercase";

/**
 * Keyword and filter controls for the search page.
 *
 * A plain GET form, so every filter ends up in the URL (shareable, bookmarkable, and readable by
 * the server component that renders the results). It needs no client-side JavaScript to work.
 */
export function SearchFilters({ criteria, categories, localityName }: Props) {
  // Sorting by distance is only offered when the URL carries coordinates, because the API rejects it otherwise.
  const hasCoordinates = criteria.lat !== undefined && criteria.lng !== undefined;

  return (
    <form
      method="GET"
      action="/search"
      className="rounded-2xl border border-line bg-white p-4 shadow-[0_8px_28px_#002a3412] sm:p-5"
    >
      {/* Changing a filter starts again at the first page. */}
      <input type="hidden" name="page" value="1" />
      {hasCoordinates ? (
        <>
          <input type="hidden" name="lat" value={criteria.lat} />
          <input type="hidden" name="lng" value={criteria.lng} />
          {criteria.radiusKm !== undefined ? <input type="hidden" name="radiusKm" value={criteria.radiusKm} /> : null}
        </>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="search-q" className="sr-only">
            Business, service or keyword
          </label>
          <input
            id="search-q"
            name="q"
            type="search"
            defaultValue={criteria.q ?? ""}
            placeholder="Business name, service or keyword"
            autoComplete="off"
            className={fieldClass}
          />
        </div>
        <button
          type="submit"
          className="cursor-pointer rounded-full bg-brand-700 px-7 py-2.5 text-base font-extrabold text-white hover:bg-brand-800"
        >
          Search
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="search-category" className={labelClass}>
            Category
          </label>
          <select
            id="search-category"
            name="category"
            defaultValue={criteria.category ?? ""}
            className={`mt-1.5 ${fieldClass}`}
          >
            {/* Not just "no filter chosen": picking this and searching lists every business on the
                site, which is a thing people want to do and had no way to ask for. */}
            <option value="">All &mdash; every business on Hyderabad Links</option>
            {categories.map((parent) => (
              <optgroup key={parent.slug} label={parent.name}>
                <option value={parent.slug}>All {parent.name.toLowerCase()}</option>
                {parent.children.map((child) => (
                  <option key={child.slug} value={child.slug}>
                    {child.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/*
          The one client-side island in this form. It submits the chosen locality's slug in a hidden
          field, so the form stays a plain GET form and every filter still ends up in the URL.
        */}
        <LocalityCombobox
          name="locality"
          labelClassName={labelClass}
          initialSlug={criteria.locality ?? undefined}
          initialName={localityName ?? undefined}
        />

        <div>
          <label htmlFor="search-sort" className={labelClass}>
            Sort by
          </label>
          <select id="search-sort" name="sort" defaultValue={criteria.sort ?? ""} className={`mt-1.5 ${fieldClass}`}>
            <option value="">Best match</option>
            {hasCoordinates ? <option value="distance">Nearest first</option> : null}
            <option value="name">Name (A to Z)</option>
          </select>
        </div>
      </div>
    </form>
  );
}
