import { describeStatus } from "@/lib/admin-api";

/**
 * A listing's status, as one of the theme's soft badges.
 *
 * `describeStatus` already names a tone per status and is shared with the rest of the admin code,
 * so the mapping here is only from that tone to Bootstrap's contextual colour. Nothing decides a
 * colour twice.
 */
const tones = {
  grey: "bg-secondary-subtle text-secondary",
  amber: "bg-warning-subtle text-warning",
  green: "bg-success-subtle text-success",
  red: "bg-danger-subtle text-danger",
} as const;

export function StatusBadge({ status }: { status: string }) {
  const { label, tone } = describeStatus(status);
  return <span className={`badge ${tones[tone]}`}>{label}</span>;
}
