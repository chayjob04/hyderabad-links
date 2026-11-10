import { describeStatus } from "@/lib/admin-api";

const tones = {
  grey: "bg-neutral-100 text-neutral-700",
  amber: "bg-amber-100 text-amber-900",
  green: "bg-green-100 text-green-900",
  red: "bg-red-100 text-red-900",
} as const;

export function StatusBadge({ status }: { status: string }) {
  const { label, tone } = describeStatus(status);
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{label}</span>;
}
