import Link from "next/link";

/**
 * The figure card the original application uses on its own dashboards, from
 * `Views/Dashboard/Index.cshtml`: a `card card-h-100`, a `row align-items-center`, and a muted
 * truncating label above an `h4`.
 *
 * Minia's demo markup puts a tinted icon tile in the second column and the original leaves that
 * column empty. Reproducing the empty column faithfully only halved the usable width and made the
 * label truncate sooner, so the column is gone and the label has the card to itself. Nothing was
 * in it to lose.
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
  /*
   * The label and figure carried `mb-3` each, straight from the original, which on a card with no
   * chart or icon beside them left about 2rem of empty space below the number and cards far taller
   * than their content. Tightened to `mb-2` and `mb-0`: the same type, the same two lines, roughly
   * 30px less height, and every card the same height as its neighbours because they all hold
   * exactly these two lines.
   */
  const body = (
    <div className="card card-h-100 mb-0">
      <div className="card-body py-3">
        <span className="text-muted mb-2 lh-1 d-block text-truncate">{label}</span>
        <h4 className="mb-0">{value}</h4>
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
