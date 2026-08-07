/**
 * How full an item's jar is drawn on the Pantry shelves.
 *
 * Every pantry item is a clock: bought, then depleting over its restock
 * interval, then due, then overdue. The server already ships everything needed
 * to show that, so the whole visual costs no extra request -- it is arithmetic
 * over fields the pantry list was already fetching and throwing away.
 *
 * Pure on purpose: the vitest pool runs in workerd with no DOM, so keeping this
 * out of the component is what makes it testable at all.
 */

import type { ItemWithStatus } from "@shared/types";

type Cycle = Pick<ItemWithStatus, "restockIntervalDays" | "daysUntilDue" | "lastPurchasedAt">;

/**
 * How much of the restock cycle is left, 0 to 1. Full the day it was bought,
 * empty the day it falls due.
 *
 * null means there is no honest cycle to draw. That is mostly the never-bought
 * case: the server measures `daysSince` from `created_at` when an item has no
 * purchases (src/worker/restock.ts:33), which is a fine basis for nagging but
 * is not a fill level. Rendering it would put a confidently half-full jar under
 * something nobody has ever bought.
 */
export function jarFill(item: Cycle): number | null {
  if (item.lastPurchasedAt === null || item.daysUntilDue === null) return null;

  const interval = item.restockIntervalDays;
  if (!Number.isFinite(interval) || interval <= 0) return null;

  // Clamped at both ends: overdue sends daysUntilDue negative, and a phone
  // whose clock is ahead of the server's can send it past the interval.
  return Math.max(0, Math.min(1, item.daysUntilDue / interval));
}

/** The line under the jar. Short: it sits in a third-of-a-screen column. */
export function jarCaption(item: Cycle): string {
  if (item.lastPurchasedAt === null) return "not bought yet";

  const days = item.daysUntilDue ?? 0;
  if (days > 0) return `${days}d left`;
  if (days === 0) return "due today";
  return `${-days}d late`;
}
