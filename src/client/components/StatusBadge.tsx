import type { RestockStatus } from "@shared/types";

const config: Record<RestockStatus, { label: string; className: string }> = {
  overdue:  { label: "Overdue",  className: "bg-status-overdue-bg text-status-overdue" },
  due:      { label: "Due",      className: "bg-status-due-bg text-status-due" },
  due_soon: { label: "Due Soon", className: "bg-status-due-soon-bg text-status-due-soon" },
  ok:       { label: "OK",       className: "bg-status-ok-bg text-status-ok" },
};

export function StatusBadge({ status }: { status: RestockStatus }) {
  const c = config[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${c.className}`}>
      {c.label}
    </span>
  );
}
