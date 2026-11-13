import Link from "next/link";

/**
 * The figure card the original application uses on its own dashboards, from
 * `Views/Dashboard/Index.cshtml`: a `card card-h-100`, a `row align-items-center`, and a muted
 * truncating label above an `h4`.
 *
 * Minia's demo markup puts a tinted icon tile in the second column. The original leaves it empty,
 * so this does too — the point is to match the application being migrated, not the theme's
 * showcase.
 *
 * `href` makes the whole card a link, which the original has no equivalent for; it is kept because
 * removing it would take away a shortcut the panels already had. It changes nothing visually
 * except the cursor.
 */
export function StatCard({
  label,
  value,
  href,
  width = "col-xl-3 col-md-6",
}: {
  label: string;
  value: number | string;
  href?: string;
  /** Grid columns, so a row of two reads as wide as a row of four. */
  width?: string;
}) {
  const body = (
    <div className="card card-h-100">
      <div className="card-body">
        <div className="row align-items-center">
          <div className="col-6">
            <span className="text-muted mb-3 lh-1 d-block text-truncate">{label}</span>
            <h4 className="mb-3">{value}</h4>
          </div>
          <div className="col-6" />
        </div>
      </div>
    </div>
  );

  return (
    <div className={width}>
      {href ? (
        <Link href={href} className="text-reset text-decoration-none d-block h-100">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
