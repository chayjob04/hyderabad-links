import Link from "next/link";

type Props = {
  /** The page being shown. May be past the end, which is why the links are clamped below. */
  page: number;
  totalPages: number;
  /** Current query string. The page number is replaced; every other filter is kept. */
  params: Record<string, string | undefined>;
  basePath: string;
};

function hrefFor(basePath: string, params: Props["params"], page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "page" && value !== undefined && value !== "") {
      query.set(key, value);
    }
  }
  query.set("page", String(page));
  return `${basePath}?${query.toString()}`;
}

/**
 * Previous/next paging, on the theme's `.pagination`. Renders nothing when everything fits on one
 * page.
 *
 * Shared by every paged staff screen, which is why it was worth converting early: one change here
 * puts Minia's paging on the listings queue, the review queue, the report queue and the rest at
 * once.
 */
export function Pagination({ page, totalPages, params, basePath }: Props) {
  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(page, 1), totalPages);

  return (
    <nav aria-label="Pagination" className="d-flex align-items-center justify-content-between mt-3">
      <p className="text-muted mb-0 font-size-13" aria-live="polite">
        Page {current} of {totalPages}
      </p>

      <ul className="pagination pagination-rounded mb-0">
        <li className={`page-item${current > 1 ? "" : " disabled"}`}>
          {current > 1 ? (
            <Link href={hrefFor(basePath, params, current - 1)} rel="prev" className="page-link">
              <i className="mdi mdi-chevron-left" />
            </Link>
          ) : (
            <span className="page-link" aria-disabled="true">
              <i className="mdi mdi-chevron-left" />
            </span>
          )}
        </li>
        <li className={`page-item${current < totalPages ? "" : " disabled"}`}>
          {current < totalPages ? (
            <Link href={hrefFor(basePath, params, current + 1)} rel="next" className="page-link">
              <i className="mdi mdi-chevron-right" />
            </Link>
          ) : (
            <span className="page-link" aria-disabled="true">
              <i className="mdi mdi-chevron-right" />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
