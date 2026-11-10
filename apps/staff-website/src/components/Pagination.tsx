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

/** Previous/next paging. Renders nothing when everything fits on one page. */
export function Pagination({ page, totalPages, params, basePath }: Props) {
  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(page, 1), totalPages);
  const linkClass = "rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50";
  const disabledClass = "rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-400";

  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-3">
      {current > 1 ? (
        <Link href={hrefFor(basePath, params, current - 1)} rel="prev" className={linkClass}>
          Previous
        </Link>
      ) : (
        <span className={disabledClass} aria-disabled="true">
          Previous
        </span>
      )}

      <p className="text-sm text-neutral-600" aria-live="polite">
        Page {current} of {totalPages}
      </p>

      {current < totalPages ? (
        <Link href={hrefFor(basePath, params, current + 1)} rel="next" className={linkClass}>
          Next
        </Link>
      ) : (
        <span className={disabledClass} aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}
