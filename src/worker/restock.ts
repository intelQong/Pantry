// The restock engine.
//
// Part A below is pure math -- no DB, no I/O -- so it is exhaustively unit
// testable without spinning up D1. Part B (relearnInterval) is the one
// DB-touching piece: it composes the pure helpers with a couple of queries.

import type { RestockStatus } from "../shared/types";

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export interface RestockItemInput {
  last_purchased_at: number | null;
  created_at: number;
  restock_interval_days: number;
}

export interface StatusResult {
  status: RestockStatus;
  daysSince: number;
  daysUntilDue: number;
  neverPurchased: boolean;
}

export function computeStatus(
  item: RestockItemInput,
  leadDays: number,
  nowSeconds: number,
): StatusResult {
  const neverPurchased = item.last_purchased_at === null;
  // Falling back to created_at (rather than treating "never bought" as
  // "infinitely overdue") is deliberate: a freshly set-up pantry has no
  // purchase history for anything, and without this fallback every staple
  // would show as due on day one.
  const reference = item.last_purchased_at ?? item.created_at;
  const daysSince = Math.floor((nowSeconds - reference) / 86400);
  const interval = item.restock_interval_days;
  const daysUntilDue = interval - daysSince;

  let status: RestockStatus;
  if (daysSince >= interval * 1.5) {
    status = "overdue";
  } else if (daysSince >= interval) {
    status = "due";
  } else if (daysSince >= interval - leadDays) {
    status = "due_soon";
  } else {
    status = "ok";
  }

  return { status, daysSince, daysUntilDue, neverPurchased };
}

const URGENCY_RANK: Record<RestockStatus, number> = { overdue: 0, due: 1, due_soon: 2, ok: 3 };

/** Sort comparator: most urgent first (overdue, due, due_soon, then ok). */
export function byUrgency(a: { status: RestockStatus }, b: { status: RestockStatus }): number {
  return URGENCY_RANK[a.status] - URGENCY_RANK[b.status];
}

/* -------------------------------------------------------------------------- */
/* Interval auto-learning                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Median gap (in days) between consecutive purchases, or null if there isn't
 * enough history yet (fewer than 3 purchases = fewer than 2 gaps).
 *
 * Median, not mean: one bulk buy before guests, or one skipped trip during a
 * vacation, produces a single wildly-off gap. A mean lets that one outlier
 * drag the whole learned interval with it; the median just shrugs it off.
 */
export function medianGapDays(purchaseTimestamps: number[]): number | null {
  const sorted = [...purchaseTimestamps].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i]! - sorted[i - 1]!) / 86400);
  }
  if (gaps.length < 2) return null;

  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[mid - 1]! + gaps[mid]!) / 2 : gaps[mid]!;
}

/**
 * The interval to switch to, or null to mean "leave it alone".
 *
 * The candidate is clamped to a sane [1, 365] day range, and is only adopted
 * if it differs from the current interval by more than 20%. Without that
 * guard, the interval would churn by a day or two after almost every single
 * shop -- a household's actual rhythm is noisy, and re-committing to it on
 * every purchase would make "restock_interval_days" meaningless as a signal.
 */
export function nextInterval(currentInterval: number, medianGap: number | null): number | null {
  if (medianGap === null) return null;

  const candidate = Math.min(365, Math.max(1, Math.round(medianGap)));
  const change = Math.abs(candidate - currentInterval) / currentInterval;
  if (change <= 0.2) return null;

  return candidate;
}

/**
 * Loads an item's purchase history and, if the learned rhythm has genuinely
 * shifted, updates restock_interval_days. A no-op when the item is locked
 * (interval_locked = 1) -- that flag means the user's number is authoritative
 * and the engine must never silently overwrite it -- or when there isn't
 * enough history, or when the shift isn't big enough to matter.
 */
export async function relearnInterval(
  db: D1Database,
  itemId: string,
  householdId: string,
): Promise<void> {
  const item = await db
    .prepare("SELECT restock_interval_days, interval_locked FROM item WHERE id = ? AND household_id = ?")
    .bind(itemId, householdId)
    .first<{ restock_interval_days: number; interval_locked: number }>();

  if (!item || item.interval_locked === 1) return;

  const rows = await db
    .prepare("SELECT purchased_at FROM purchase WHERE item_id = ? AND household_id = ? ORDER BY purchased_at")
    .bind(itemId, householdId)
    .all<{ purchased_at: number }>();

  const gap = medianGapDays(rows.results.map((r) => r.purchased_at));
  const next = nextInterval(item.restock_interval_days, gap);
  if (next === null) return;

  await db
    .prepare("UPDATE item SET restock_interval_days = ? WHERE id = ? AND household_id = ?")
    .bind(next, itemId, householdId)
    .run();
}

/* -------------------------------------------------------------------------- */
/* Local time                                                                  */
/* -------------------------------------------------------------------------- */

export interface LocalParts {
  /** 'YYYY-MM-DD' in the given timezone. */
  date: string;
  hour: number;
  /** 1=Mon..7=Sun */
  isoWeekday: number;
}

const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Breaks a UTC instant into the wall-clock date/hour/weekday of `timeZone`,
 * via Intl rather than manual UTC-offset arithmetic. Manual offset math
 * breaks twice a year around DST transitions; Intl's tz database does not.
 */
export function localParts(nowSeconds: number, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23", // forces a plain 0-23 hour, sidestepping "24" edge cases
    weekday: "short",
  });

  const parts = formatter.formatToParts(new Date(nowSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
    isoWeekday: ISO_WEEKDAY[get("weekday")] ?? 1,
  };
}

/**
 * Whether `hour` falls in the [quietStart, quietEnd) quiet window. The window
 * wraps midnight (e.g. 22 -> 7), so it can't be treated as a plain numeric
 * range -- that's the only reason this isn't just `start <= hour < end`.
 */
export function isQuietHour(hour: number, quietStart: number, quietEnd: number): boolean {
  // [start, start) is empty: equal ends mean no quiet hours, not all-day quiet.
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) {
    return hour >= quietStart && hour < quietEnd;
  }
  return hour >= quietStart || hour < quietEnd;
}
