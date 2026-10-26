import type { Metadata } from "next";
import {
  PERMISSION_TAXONOMY,
  getAdminCities,
  getAdminLocalities,
  getAdminProfile,
  type AdminLocality,
} from "@/lib/admin-api";
import {
  addLocalityAction,
  deleteLocalityAction,
  editLocalityAction,
  toggleLocalityAction,
} from "./actions";

export const metadata: Metadata = { title: "Locations" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

export default async function LocationsPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, cityResult, me] = await Promise.all([
    getAdminLocalities(),
    getAdminCities(),
    getAdminProfile(),
  ]);

  if (me.ok && !me.data.permissions.includes(PERMISSION_TAXONOMY)) {
    return (
      <main className="mx-auto max-w-5xl px-4 pt-8">
        <h1 className="text-2xl font-bold">Locations</h1>
        <p className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          Your account cannot manage locations. Ask a super admin for the &quot;Manage categories,
          subcategories and localities&quot; permission.
        </p>
      </main>
    );
  }

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-5xl px-4 pt-8">
        <h1 className="text-2xl font-bold">Locations</h1>
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {result.message}
        </p>
      </main>
    );
  }

  const localities = result.data;
  const cities = cityResult.ok ? cityResult.data.filter((city) => city.isActive) : [];

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      <h1 className="text-2xl font-bold">Locations</h1>
      <p className="mt-1 text-neutral-600">
        The areas of Hyderabad a business can be listed in. Each one needs a centre point, because
        that is what every distance and &quot;near me&quot; result is measured from.
      </p>

      <Notice done={done} error={error} />

      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Add an area</h2>
        <p className="mt-1 text-sm text-neutral-600">
          The easiest way to get the centre: find the area on Google Maps, right-click it, and copy
          the two numbers it shows.
        </p>
        <form action={addLocalityAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="font-medium">City</span>
            <select
              name="citySlug"
              required
              defaultValue={cities[0]?.slug ?? ""}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
            >
              {cities.map((city) => (
                <option key={city.slug} value={city.slug}>
                  {city.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 min-w-[10rem] text-sm">
            <span className="font-medium">Name</span>
            <input
              name="name"
              required
              maxLength={200}
              placeholder="Madhapur"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="font-medium">Latitude</span>
            <input
              name="latitude"
              required
              inputMode="decimal"
              placeholder="17.4483"
              className="mt-1 w-28 rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="font-medium">Longitude</span>
            <input
              name="longitude"
              required
              inputMode="decimal"
              placeholder="78.3915"
              className="mt-1 w-28 rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="font-medium">Pincode</span>
            <input
              name="pincode"
              inputMode="numeric"
              maxLength={6}
              placeholder="500081"
              className="mt-1 w-28 rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900"
          >
            Add
          </button>
        </form>
      </section>

      {localities.length === 0 ? (
        <p className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          There are no areas yet. Add one above.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {localities.map((locality) => (
            <li key={locality.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <LocalityRow locality={locality} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * One area. The name, centre and pincode save together, because moving a centre without saying
 * which area it belongs to is not a thing anyone wants to do separately. Delete only shows when no
 * listing sits in the area.
 */
function LocalityRow({ locality }: { locality: AdminLocality }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <form action={editLocalityAction.bind(null, locality.id)} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="sr-only">Name</span>
          <input
            name="name"
            defaultValue={locality.name}
            required
            maxLength={200}
            className="w-44 rounded-lg border border-neutral-300 px-3 py-1.5 font-medium"
          />
        </label>
        <label className="text-sm">
          <span className="sr-only">Latitude</span>
          <input
            name="latitude"
            defaultValue={locality.latitude}
            required
            inputMode="decimal"
            className="w-28 rounded-lg border border-neutral-300 px-3 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="sr-only">Longitude</span>
          <input
            name="longitude"
            defaultValue={locality.longitude}
            required
            inputMode="decimal"
            className="w-28 rounded-lg border border-neutral-300 px-3 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="sr-only">Pincode</span>
          <input
            name="pincode"
            defaultValue={locality.pincode ?? ""}
            inputMode="numeric"
            maxLength={6}
            placeholder="Pincode"
            className="w-24 rounded-lg border border-neutral-300 px-3 py-1.5"
          />
        </label>
        <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
          Save
        </button>
        <span className="text-sm text-neutral-500">
          /{locality.citySlug}/{locality.slug} &middot; {locality.listingCount} listing
          {locality.listingCount === 1 ? "" : "s"}
        </span>
      </form>

      <div className="flex items-center gap-2">
        {locality.isActive ? (
          <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">On the site</span>
        ) : (
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700">Switched off</span>
        )}

        <form action={toggleLocalityAction.bind(null, locality.id, !locality.isActive)}>
          <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
            {locality.isActive ? "Switch off" : "Switch on"}
          </button>
        </form>

        {locality.listingCount === 0 ? (
          <form action={deleteLocalityAction.bind(null, locality.id)}>
            <button type="submit" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
              Delete
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function Notice({ done, error }: { done?: string; error?: string }) {
  if (error) {
    return (
      <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
        {error}
      </p>
    );
  }
  if (done) {
    return (
      <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-green-800">
        {done}
      </p>
    );
  }
  return null;
}
