import type { Purchase } from "@shared/types";

/**
 * `<input type="date">` speaks 'YYYY-MM-DD' in the user's own calendar, and the
 * database speaks epoch seconds. These two convert between them in *local* time
 * on purpose: someone picking "14 July" means midnight on the 14th where they
 * are standing, and parsing it as UTC would land the entry on the 13th for
 * anyone east of Greenwich -- which is everyone using this app.
 */
export function dateInputToEpochSeconds(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(new Date(year!, month! - 1, day!).getTime() / 1000);
}

export function epochSecondsToDateInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export interface PurchaseMonth {
  /** 'YYYY-MM', used as the React key and for sorting. */
  key: string;
  /** Human heading, e.g. 'July 2026'. */
  label: string;
  /** Sum of priceTotal in minor units; unpriced entries contribute nothing. */
  total: number;
  purchases: Purchase[];
}

export function groupByMonth(purchases: Purchase[]): PurchaseMonth[] {
  const months = new Map<string, Purchase[]>();

  for (const p of purchases) {
    const key = epochSecondsToDateInput(p.purchasedAt).slice(0, 7);
    const bucket = months.get(key);
    if (bucket) bucket.push(p);
    else months.set(key, [p]);
  }

  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => b.purchasedAt - a.purchasedAt);
      return {
        key,
        label: new Date(sorted[0]!.purchasedAt * 1000).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        }),
        total: sorted.reduce((sum, p) => sum + (p.priceTotal ?? 0), 0),
        purchases: sorted,
      };
    });
}
