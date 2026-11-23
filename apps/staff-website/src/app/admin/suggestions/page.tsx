import type { Metadata } from "next";
import { EmptyState, FilterTabs } from "@/components/minia/FilterTabs";
import { PageTitle } from "@/components/minia/PageTitle";
import {
  PERMISSION_TAXONOMY,
  formatWhen,
  getAdminCategories,
  getAdminCities,
  getAdminProfile,
  listSuggestions,
  type TaxonomySuggestion,
} from "@/lib/admin-api";
import { approveSuggestionAction, markExistsAction, rejectSuggestionAction } from "./actions";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ status?: string; done?: string; error?: string }> };

const TABS = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Added" },
  { value: "already_exists", label: "Already there" },
  { value: "rejected", label: "Turned down" },
  { value: "all", label: "Everything" },
] as const;

/**
 * Owners' requests for an area or a category that does not exist yet (S0032).
 *
 * The sign-up form has always let somebody say "my area is not listed" and type the name. Nothing
 * was kept: the name went back to them with a prefilled email to support, and if nobody sent that
 * email the request was gone. This is the queue that replaced the hope.
 *
 * <b>Approving one creates it, and asks for what only a person knows.</b> An area needs a city and
 * a point on the map, because "near me" ranks by distance from it; a category needs the category it
 * belongs under, because a business can only be listed under a subcategory. So each row carries a
 * small form rather than a one-click button — the click would have to invent those facts.
 *
 * "Already there" is deliberately not a rejection. The owner was right to ask, and the answer is
 * the name we actually use.
 */
export default async function SuggestionsPage({ searchParams }: Props) {
  const { status, done, error } = await searchParams;
  const wanted = TABS.some((tab) => tab.value === status) ? status! : "pending";

  const [result, me, categories, cities] = await Promise.all([
    listSuggestions(wanted),
    getAdminProfile(),
    getAdminCategories(),
    getAdminCities(),
  ]);

  const title = (
    <PageTitle title="Requests" breadcrumb={[{ label: "Configurations" }, { label: "Requests" }]} />
  );

  // The API refuses every call anyway; this only avoids showing forms that would bounce.
  if (me.ok && !me.data.permissions.includes(PERMISSION_TAXONOMY)) {
    return (
      <>
        {title}
        <div className="alert alert-light border">
          Your account cannot manage areas and categories, so it cannot decide these requests. Ask a
          super admin for the &quot;Manage categories, subcategories and localities&quot; permission.
        </div>
      </>
    );
  }

  const categoryOptions = categories.ok ? categories.data : [];
  const cityOptions = cities.ok ? cities.data.filter((city) => city.isActive) : [];

  return (
    <>
      {title}

      {done ? (
        <div role="status" className="alert alert-success">
          {done}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      ) : null}

      <div className="row g-3">
        <div className="col-12">
          <div className="card mb-0">
            <div className="card-body">
              <h4 className="card-title mb-1">Areas and categories owners have asked for</h4>
              <p className="card-title-desc mb-3">
                Oldest first. Adding one creates it for the whole directory, so the area&apos;s place
                on the map and the category it sits under are asked for here rather than guessed.
              </p>

              <FilterTabs
                tabs={TABS}
                current={wanted}
                hrefFor={(value) => `/admin/suggestions?status=${value}`}
                label="Filter requests"
              />

              {!result.ok ? (
                <div role="alert" className="alert alert-danger mb-0">
                  {result.message}
                </div>
              ) : result.data.length === 0 ? (
                <EmptyState icon="bx bx-message-square-add" title="Nothing waiting">
                  No owner has asked for an area or a category in this state.
                </EmptyState>
              ) : (
                <div className="d-grid gap-3">
                  {result.data.map((suggestion) => (
                    <SuggestionCard
                      key={suggestion.id}
                      suggestion={suggestion}
                      categories={categoryOptions}
                      cities={cityOptions}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** One request: who asked, for what, and the three things that can be done about it. */
function SuggestionCard({
  suggestion,
  categories,
  cities,
}: {
  suggestion: TaxonomySuggestion;
  categories: { id: number; name: string; level: number }[];
  cities: { slug: string; name: string }[];
}) {
  const pending = suggestion.status === "pending";
  const isArea = suggestion.kind === "locality";

  return (
    <div className="border rounded p-3">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
        <div>
          <h5 className="font-size-15 mb-1">
            {suggestion.suggestedName}
            <span className="text-muted fw-normal font-size-13">
              {" "}
              &middot; {isArea ? "area" : "category"}
            </span>
          </h5>
          <p className="text-muted font-size-12 mb-0">
            Asked {formatWhen(suggestion.createdAt)}
            {suggestion.requestedByName || suggestion.requestedByPhone ? (
              <> by {suggestion.requestedByName ?? suggestion.requestedByPhone}</>
            ) : null}
            {suggestion.listingName ? <> for {suggestion.listingName}</> : null}
          </p>
        </div>
        <span
          className={`badge ${
            suggestion.status === "pending"
              ? "bg-warning-subtle text-warning"
              : suggestion.status === "approved"
                ? "bg-success-subtle text-success"
                : suggestion.status === "already_exists"
                  ? "bg-info-subtle text-info"
                  : "bg-danger-subtle text-danger"
          }`}
        >
          {suggestion.status.replace("_", " ")}
        </span>
      </div>

      {suggestion.resolvedName ? (
        <p className="text-success font-size-13 mt-2 mb-0">
          Added as <span className="fw-semibold">{suggestion.resolvedName}</span>
          {suggestion.reviewedBy ? <> by {suggestion.reviewedBy}</> : null}
        </p>
      ) : null}

      {suggestion.note ? (
        <p className="alert alert-light border font-size-13 mt-2 mb-0">
          <span className="fw-semibold">Note to the owner:</span> {suggestion.note}
        </p>
      ) : null}

      {pending ? (
        <div className="row g-3 mt-2">
          {/* Add it. The fields are what the taxonomy screens ask for when an admin types one in
              by hand, because this creates exactly the same row. */}
          <div className="col-lg-7">
            <form
              action={approveSuggestionAction.bind(null, suggestion.id, suggestion.kind)}
              className="row g-2 align-items-end"
            >
              <div className="col-12">
                <label htmlFor={`name-${suggestion.id}`} className="form-label mb-1 font-size-13">
                  Name to add it under
                </label>
                <input
                  id={`name-${suggestion.id}`}
                  name="name"
                  defaultValue={suggestion.suggestedName}
                  maxLength={200}
                  className="form-control form-control-sm"
                />
              </div>

              {isArea ? (
                <>
                  <div className="col-sm-4">
                    <label htmlFor={`city-${suggestion.id}`} className="form-label mb-1 font-size-13">
                      City
                    </label>
                    <select
                      id={`city-${suggestion.id}`}
                      name="citySlug"
                      defaultValue={cities[0]?.slug ?? ""}
                      className="form-select form-select-sm"
                    >
                      {cities.map((city) => (
                        <option key={city.slug} value={city.slug}>
                          {city.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-sm-3">
                    <label htmlFor={`lat-${suggestion.id}`} className="form-label mb-1 font-size-13">
                      Latitude
                    </label>
                    <input
                      id={`lat-${suggestion.id}`}
                      name="latitude"
                      inputMode="decimal"
                      placeholder="17.4449"
                      className="form-control form-control-sm"
                    />
                  </div>
                  <div className="col-sm-3">
                    <label htmlFor={`lng-${suggestion.id}`} className="form-label mb-1 font-size-13">
                      Longitude
                    </label>
                    <input
                      id={`lng-${suggestion.id}`}
                      name="longitude"
                      inputMode="decimal"
                      placeholder="78.3915"
                      className="form-control form-control-sm"
                    />
                  </div>
                  <div className="col-sm-2">
                    <label htmlFor={`pin-${suggestion.id}`} className="form-label mb-1 font-size-13">
                      Pincode
                    </label>
                    <input
                      id={`pin-${suggestion.id}`}
                      name="pincode"
                      inputMode="numeric"
                      maxLength={6}
                      className="form-control form-control-sm"
                    />
                  </div>
                </>
              ) : (
                <div className="col-sm-9">
                  <label htmlFor={`parent-${suggestion.id}`} className="form-label mb-1 font-size-13">
                    Under which category
                  </label>
                  <select
                    id={`parent-${suggestion.id}`}
                    name="parentId"
                    className="form-select form-select-sm"
                    required
                  >
                    <option value="">Choose a category…</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="col-sm-3">
                <button type="submit" className="btn btn-sm btn-primary w-100">
                  Add it
                </button>
              </div>
            </form>
          </div>

          {/* The two answers that create nothing. Both need words, because the owner reads them. */}
          <div className="col-lg-5">
            <form
              action={markExistsAction.bind(null, suggestion.id)}
              className="d-flex flex-wrap gap-2 align-items-end"
            >
              <div className="flex-grow-1">
                <label htmlFor={`exists-${suggestion.id}`} className="form-label mb-1 font-size-13">
                  Already there as…
                </label>
                <input
                  id={`exists-${suggestion.id}`}
                  name="note"
                  maxLength={1000}
                  placeholder="We call it HITEC City"
                  className="form-control form-control-sm"
                />
              </div>
              <button type="submit" className="btn btn-sm btn-outline-secondary" formNoValidate>
                Mark
              </button>
            </form>

            <form
              action={rejectSuggestionAction.bind(null, suggestion.id)}
              className="d-flex flex-wrap gap-2 align-items-end mt-2"
            >
              <div className="flex-grow-1">
                <label htmlFor={`reject-${suggestion.id}`} className="form-label mb-1 font-size-13">
                  Turn it down because…
                </label>
                <input
                  id={`reject-${suggestion.id}`}
                  name="note"
                  maxLength={1000}
                  placeholder="This is a building, not an area"
                  className="form-control form-control-sm"
                />
              </div>
              <button type="submit" className="btn btn-sm btn-outline-danger" formNoValidate>
                Turn down
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
