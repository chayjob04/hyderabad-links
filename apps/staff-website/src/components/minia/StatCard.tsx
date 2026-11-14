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
  width = "col-xl-3 col-md-6 col-sm-6",
}: {
  label: string;
  value: number | string;
  href?: string;
  /**
   * Grid columns. The default is a quarter on a wide screen and a half below it, so a row of two
   * fills the width instead of leaving half the row empty — which is what "Reviews waiting" and
   * "Reports open" did on the dashboard.
   */
  width?: string;
}) {
  /*
   * The label and figure carried `mb-3` each, straight from the original, which on a card with no
   * chart or icon beside them left about 2rem of empty space below the number and cards far taller
   * than their content. Tightened to `mb-2` and `mb-0`: the same type, the same two lines, roughly
   * 30px less height, and every card the same height as its neighbours because they all hold
   * exactly these two lines.
   */
  /*
   * Trimmed to `py-3` in the last pass, which went too far the other way: the label sat almost on
   * top of the figure and the cards read as cramped. Default `card-body` padding back, the label
   * and figure two steps apart, and a minimum height so a one-digit card and a long wrapped label
   * end up the same size in a row.
   */
  const body = (
    <div className="card card-h-100 mb-0">
      <div className="card-body d-flex flex-column justify-content-center" style={{ minHeight: "6.5rem" }}>
        <span className="text-muted mb-2 lh-sm d-block text-truncate">{label}</span>
        <h4 className="mb-0 lh-1">{value}</h4>
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
