import Link from "next/link";

/**
 * The theme's `page-title-box`: the heading every Minia screen opens with, with a breadcrumb on
 * the right. Taken from the original views, which all begin with this same block.
 *
 * The original put only a breadcrumb on the right. Several screens here need a primary action
 * beside the title instead — Create admin, for one — so `action` renders in the same place, below
 * the breadcrumb on a small screen for the same reason the theme stacks the breadcrumb there.
 */
export type Crumb = { label: string; href?: string };

export function PageTitle({
  title,
  breadcrumb,
  action,
}: {
  title: string;
  breadcrumb?: Crumb[];
  action?: React.ReactNode;
}) {
  return (
    <div className="row">
      <div className="col-12">
        <div className="page-title-box d-sm-flex align-items-center justify-content-between">
          <h4 className="mb-sm-0 font-size-18">{title}</h4>

          <div className="page-title-right d-flex align-items-center gap-2">
            {breadcrumb && breadcrumb.length > 0 ? (
              <ol className="breadcrumb m-0">
                {breadcrumb.map((crumb, index) => {
                  const last = index === breadcrumb.length - 1;
                  return (
                    <li key={crumb.label} className={`breadcrumb-item${last ? " active" : ""}`}>
                      {crumb.href && !last ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}
