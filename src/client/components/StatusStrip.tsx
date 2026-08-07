import type { RestockStatus } from "@shared/types";

/**
 * One proportional bar summarising how a set of tracked items sits: how many
 * are overdue, due, coming up, and stocked.
 *
 * Segments are sized with flexGrow rather than percentages so the widths are
 * the counts themselves, and the whole strip is a single `role="img"` -- four
 * coloured divs mean nothing announced one at a time.
 *
 * Lives here rather than on Today because Pantry needs the same summary, and a
 * second copy is a second thing to keep in step.
 */
const TALLY: Array<{ status: RestockStatus; label: string; bar: string; dot: string }> = [
  { status: "overdue", label: "overdue", bar: "bg-status-overdue", dot: "bg-status-overdue" },
  { status: "due", label: "due", bar: "bg-status-due", dot: "bg-status-due" },
  { status: "due_soon", label: "soon", bar: "bg-status-due-soon", dot: "bg-status-due-soon" },
  { status: "ok", label: "stocked", bar: "bg-status-ok", dot: "bg-status-ok" },
];

export function StatusStrip({ items }: { items: Array<{ status: RestockStatus }> }) {
  const counts = TALLY.map((t) => items.filter((i) => i.status === t.status).length);

  return (
    <>
      <div
        className="flex gap-1 h-2 mb-3"
        role="img"
        aria-label={TALLY.map((t, i) => `${counts[i]} ${t.label}`).join(", ")}
      >
        {TALLY.map((t, i) =>
          counts[i]! > 0 ? (
            <div key={t.status} className={`${t.bar} rounded-full`} style={{ flexGrow: counts[i] }} />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {TALLY.map((t, i) =>
          counts[i]! > 0 ? (
            <span key={t.status} className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
              <span className="numeral font-medium text-text">{counts[i]}</span>
              {t.label}
            </span>
          ) : null,
        )}
      </div>
    </>
  );
}
