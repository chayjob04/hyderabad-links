import type { Metadata } from "next";
import { EmptyState } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
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

/**
 * The areas a business can be listed in, on the original's Minia layout.
 *
 * Each area is a row of fields rather than a table cell, because the whole row saves together:
 * name, centre and pincode are one edit. Moving a centre without saying which area it belongs to
 * is not something anyone wants to do separately.
 */
export default async function LocationsPage({ searchParams }: Props) {
  const { done, error } = await searchParams;
  const [result, cityResult, me] = await Promise.all([
    getAdminLocalities(),
    getAdminCities(),
    getAdminProfile(),
  ]);

  const title = <PageTitle title="Area" breadcrumb={[{ label: "Configurations" }, { label: "Area" }]} />;

  if (me.ok && !me.data.permissions.includes(PERMISSION_TAXONOMY)) {
    return (
      <>
        {title}
        <div className="alert alert-light border">
          Your account cannot manage locations. Ask a super admin for the &quot;Manage categories,
          subcategories and localities&quot; permission.
        </div>
      </>
    );
  }

  if (!result.ok) {
    return (
      <>
        {title}
        <div role="alert" className="alert alert-danger">
          {result.message}
        </div>
      </>
    );
  }

  const localities = result.data;
  const cities = cityResult.ok ? cityResult.data.filter((city) => city.isActive) : [];

  return (
    <>
      {title}
      <Notice done={done} error={error} />

      <div className="row g-3 mb-4">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <h4 className="card-title mb-1">Add an area</h4>
              <p className="card-title-desc mb-3">
                Each one needs a centre point, because that is what every distance and &quot;near
                me&quot; result is measured from. The easiest way to get it: find the area on Google
                Maps, right-click it, and copy the two numbers it shows.
              </p>

              <form action={addLocalityAction} className="row g-2 align-items-end">
                <div className="col-md-2">
                  <label htmlFor="citySlug" className="form-label">
                    City
                  </label>
                  <select
                    id="citySlug"
                    name="citySlug"
                    required
                    defaultValue={cities[0]?.slug ?? ""}
                    className="form-select"
                  >
                    {cities.map((city) => (
                      <option key={city.slug} value={city.slug}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-3">
                  <label htmlFor="name" className="form-label">
                    Name
                  </label>
                  <input id="name" name="name" required maxLength={200} placeholder="Madhapur" className="form-control" />
                </div>
                <div className="col-md-2">
                  <label htmlFor="latitude" className="form-label">
                    Latitude
                  </label>
                  <input id="latitude" name="latitude" required inputMode="decimal" placeholder="17.4483" className="form-control" />
                </div>
                <div className="col-md-2">
                  <label htmlFor="longitude" className="form-label">
                    Longitude
                  </label>
                  <input id="longitude" name="longitude" required inputMode="decimal" placeholder="78.3915" className="form-control" />
                </div>
                <div className="col-md-2">
                  <label htmlFor="pincode" className="form-label">
                    Pincode
                  </label>
                  <input id="pincode" name="pincode" inputMode="numeric" maxLength={6} placeholder="500081" className="form-control" />
                </div>
                <div className="col-md-1">
                  <button type="submit" className="btn btn-primary w-100">
                    Add
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Areas</h4>
              <p className="card-title-desc mb-3">
                {localities.length} area{localities.length === 1 ? "" : "s"} across Hyderabad.
              </p>

              {localities.length === 0 ? (
                <EmptyState icon="bx bx-map" title="There are no areas yet">
                  Add one above.
                </EmptyState>
              ) : (
                localities.map((locality) => (
                  <div key={locality.id} className="border rounded p-3 mb-2">
                    <LocalityRow locality={locality} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * One area. The name, centre and pincode save together. Delete only shows when no listing sits in
 * the area — the API refuses it otherwise.
 */
function LocalityRow({ locality }: { locality: AdminLocality }) {
  return (
    <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
      <form
        action={editLocalityAction.bind(null, locality.id)}
        className="d-flex flex-wrap align-items-center gap-2"
      >
        <label className="visually-hidden" htmlFor={`name-${locality.id}`}>
          Name
        </label>
        <input
          id={`name-${locality.id}`}
          name="name"
          defaultValue={locality.name}
          required
          maxLength={200}
          className="form-control form-control-sm fw-semibold"
          style={{ width: "11rem" }}
        />

        <label className="visually-hidden" htmlFor={`lat-${locality.id}`}>
          Latitude
        </label>
        <input
          id={`lat-${locality.id}`}
          name="latitude"
          defaultValue={locality.latitude}
          required
          inputMode="decimal"
          className="form-control form-control-sm"
          style={{ width: "7rem" }}
        />

        <label className="visually-hidden" htmlFor={`lng-${locality.id}`}>
          Longitude
        </label>
        <input
          id={`lng-${locality.id}`}
          name="longitude"
          defaultValue={locality.longitude}
          required
          inputMode="decimal"
          className="form-control form-control-sm"
          style={{ width: "7rem" }}
        />

        <label className="visually-hidden" htmlFor={`pin-${locality.id}`}>
          Pincode
        </label>
        <input
          id={`pin-${locality.id}`}
          name="pincode"
          defaultValue={locality.pincode ?? ""}
          inputMode="numeric"
          maxLength={6}
          placeholder="Pincode"
          className="form-control form-control-sm"
          style={{ width: "6rem" }}
        />

        <button type="submit" className="btn btn-sm btn-outline-secondary">
          Save
        </button>

        <span className="text-muted font-size-12">
          /{locality.citySlug}/{locality.slug} &middot; {locality.listingCount} listing
          {locality.listingCount === 1 ? "" : "s"}
        </span>
      </form>

      <div className="d-flex align-items-center gap-2">
        <span
          className={`badge ${
            locality.isActive ? "bg-success-subtle text-success" : "bg-secondary-subtle text-secondary"
          }`}
        >
          {locality.isActive ? "On the site" : "Switched off"}
        </span>

        <form action={toggleLocalityAction.bind(null, locality.id, !locality.isActive)}>
          <button type="submit" className="btn btn-sm btn-outline-secondary">
            {locality.isActive ? "Switch off" : "Switch on"}
          </button>
        </form>

        {locality.listingCount === 0 ? (
          <form action={deleteLocalityAction.bind(null, locality.id)}>
            <button type="submit" className="btn btn-sm btn-outline-danger">
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
      <div role="alert" className="alert alert-danger">
        {error}
      </div>
    );
  }
  if (done) {
    return (
      <div role="status" className="alert alert-success">
        {done}
      </div>
    );
  }
  return null;
}
