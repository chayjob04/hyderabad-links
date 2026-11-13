import Link from "next/link";

/**
 * The status filter row that sits above every queue — listings, reviews, reports.
 *
 * The original writes these as a row of buttons rather than Bootstrap nav-tabs, so that is what
 * this is: `.btn-primary` for the one you are on, `.btn-outline-secondary` for the rest. They stay
 * links, so the URL remains the state and a filtered queue can be shared.
 */
export type FilterTab = { value: string; label: string };

export function FilterTabs({
  tabs,
  current,
  hrefFor,
  label = "Filter by status",
}: {
  tabs: readonly FilterTab[];
  current: string;
  hrefFor: (value: string) => string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="d-flex flex-wrap gap-2 mb-3">
      {tabs.map((tab) => {
        const selected = tab.value === current;
        return (
          <Link
            key={tab.value}
            href={hrefFor(tab.value)}
            aria-current={selected ? "page" : undefined}
            className={`btn btn-sm ${selected ? "btn-primary" : "btn-outline-secondary"}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The empty state a queue shows when a filter matches nothing. Same shape as the one on Admin
 * Accounts, so the panels agree with themselves.
 */
export function EmptyState({
  icon = "bx bx-inbox",
  title,
  children,
}: {
  icon?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="text-center py-5">
      <div className="avatar-md mx-auto mb-4">
        <span className="avatar-title bg-light text-secondary rounded-circle font-size-24">
          <i className={icon} />
        </span>
      </div>
      <h5>{title}</h5>
      {children ? <p className="text-muted mb-0">{children}</p> : null}
    </div>
  );
}
