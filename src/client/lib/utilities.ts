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

export interface PurchaseDay<T> {
  /** 'YYYY-MM-DD', used as the React key and for sorting. */
  key: string;
  /** Human heading: 'Today', 'Yesterday', or e.g. 'Sat, 2 Aug'. */
  label: string;
  /** Sum of priceTotal in minor units; unpriced entries contribute nothing. */
  total: number;
  purchases: T[];
}

/**
 * Buckets purchases into the days they happened on, newest day first.
 *
 * `todayKey` is a parameter rather than read from the clock so the labelling
 * can be tested without pretending it is a particular Tuesday.
 */
export function groupByDay<T extends { purchasedAt: number; priceTotal: number | null }>(
  purchases: T[],
  todayKey: string = epochSecondsToDateInput(Date.now() / 1000),
): PurchaseDay<T>[] {
  // ponytail: naive -86400 for "yesterday". Correct everywhere without DST,
  // which includes where this app is used; a DST changeover would cost the
  // word "Yesterday" for one day a year, nothing more.
  const yesterdayKey = epochSecondsToDateInput(dateInputToEpochSeconds(todayKey) - 86400);

  const days = new Map<string, T[]>();
  for (const p of purchases) {
    const key = epochSecondsToDateInput(p.purchasedAt);
    const bucket = days.get(key);
    if (bucket) bucket.push(p);
    else days.set(key, [p]);
  }

  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => ({
      key,
      label:
        key === todayKey
          ? "Today"
          : key === yesterdayKey
            ? "Yesterday"
            : new Date(dateInputToEpochSeconds(key) * 1000).toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                // A bare 'Sat, 2 Aug' is ambiguous once the history spans a new
                // year, so older years say which one.
                ...(key.slice(0, 4) === todayKey.slice(0, 4) ? {} : { year: "numeric" }),
              }),
      total: list.reduce((sum, p) => sum + (p.priceTotal ?? 0), 0),
      purchases: [...list].sort((a, b) => b.purchasedAt - a.purchasedAt),
    }));
}

export interface PurchaseWeek<T = Purchase> {
  /** 'YYYY-MM-DD' of the Monday of this week, used as React key and for sorting. */
  key: string;
  /** Human heading: 'This week', 'Last week', or 'Week of 21 Jul'. */
  label: string;
  /** Sum of priceTotal in minor units; unpriced entries contribute nothing. */
  total: number;
  purchases: T[];
}

export function groupByWeek<T extends { purchasedAt: number; priceTotal: number | null }>(
  purchases: T[],
  todayKey: string = epochSecondsToDateInput(Date.now() / 1000),
): PurchaseWeek<T>[] {
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const todayDt = new Date(ty!, tm! - 1, td!);
  const todayDiff = (todayDt.getDay() + 6) % 7;
  const thisMondayDt = new Date(ty!, tm! - 1, td! - todayDiff);
  const thisMondayKey = epochSecondsToDateInput(Math.floor(thisMondayDt.getTime() / 1000));
  const lastMondayDt = new Date(ty!, tm! - 1, td! - todayDiff - 7);
  const lastMondayKey = epochSecondsToDateInput(Math.floor(lastMondayDt.getTime() / 1000));

  const weeks = new Map<string, T[]>();
  for (const p of purchases) {
    const dateStr = epochSecondsToDateInput(p.purchasedAt);
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y!, m! - 1, d!);
    const diffToMonday = (dt.getDay() + 6) % 7;
    const mondayDt = new Date(y!, m! - 1, d! - diffToMonday);
    const mondayKey = epochSecondsToDateInput(Math.floor(mondayDt.getTime() / 1000));

    const bucket = weeks.get(mondayKey);
    if (bucket) bucket.push(p);
    else weeks.set(mondayKey, [p]);
  }

  return [...weeks.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => {
      const mDate = new Date(dateInputToEpochSeconds(key) * 1000);
      const label =
        key === thisMondayKey
          ? "This week"
          : key === lastMondayKey
            ? "Last week"
            : `Week of ${mDate.toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                ...(key.slice(0, 4) === todayKey.slice(0, 4) ? {} : { year: "numeric" }),
              })}`;
      return {
        key,
        label,
        total: list.reduce((sum, p) => sum + (p.priceTotal ?? 0), 0),
        purchases: [...list].sort((a, b) => b.purchasedAt - a.purchasedAt),
      };
    });
}

export interface PurchaseMonth<T = Purchase> {
  /** 'YYYY-MM', used as the React key and for sorting. */
  key: string;
  /** Human heading, e.g. 'July 2026'. */
  label: string;
  /** Sum of priceTotal in minor units; unpriced entries contribute nothing. */
  total: number;
  purchases: T[];
}

export function groupByMonth<T extends { purchasedAt: number; priceTotal: number | null }>(
  purchases: T[],
): PurchaseMonth<T>[] {
  const months = new Map<string, T[]>();

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

/**
 * Given a 'YYYY-MM' key, returns the human label for the following month,
 * e.g. '2026-09' -> 'October 2026'.
 */
export function getNextMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return "Next Month";
  // m is 1-12. new Date(year, m, 1) creates the month indexed at m (0-indexed), which is the next month.
  const nextMonthDate = new Date(y, m, 1);
  return nextMonthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * Given a 'YYYY-MM' key, returns the month name, e.g. '2026-09' -> 'September'.
 */
export function getMonthName(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString(undefined, { month: "long" });
}

export interface MonthlyBillBreakdown<T = Purchase> {
  key: string;
  label: string;
  nextMonthLabel: string;
  groceryTotal: number;
  groceryPurchases: T[];
  utilityTotal: number;
  utilityPurchases: T[];
  allPurchases: T[];
}

/**
 * Computes monthly bill breakdowns separating non-utility grocery purchases
 * (which form the grocery bill to be paid next month) from utility payments.
 */
export function groupMonthlyBills<T extends { itemId: string; purchasedAt: number; priceTotal: number | null }>(
  purchases: T[],
  utilityItemIds: Set<string>,
  currentMonthKey: string = epochSecondsToDateInput(Date.now() / 1000).slice(0, 7),
): MonthlyBillBreakdown<T>[] {
  const map = new Map<string, T[]>();
  for (const p of purchases) {
    const key = epochSecondsToDateInput(p.purchasedAt).slice(0, 7);
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }

  // Ensure current month is present even if no purchases yet
  if (!map.has(currentMonthKey)) {
    map.set(currentMonthKey, []);
  }

  const keys = [...map.keys()].sort((a, b) => b.localeCompare(a));

  return keys.map((key) => {
    const list = map.get(key) ?? [];
    const groceryPurchases = list.filter((p) => !utilityItemIds.has(p.itemId));
    const utilityPurchases = list.filter((p) => utilityItemIds.has(p.itemId));

    const groceryTotal = groceryPurchases.reduce((sum, p) => sum + (p.priceTotal ?? 0), 0);
    const utilityTotal = utilityPurchases.reduce((sum, p) => sum + (p.priceTotal ?? 0), 0);

    const [y, m] = key.split("-").map(Number);
    const monthDate = new Date(y!, m! - 1, 1);
    const label = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const nextMonthLabel = getNextMonthLabel(key);

    return {
      key,
      label,
      nextMonthLabel,
      groceryTotal,
      groceryPurchases: [...groceryPurchases].sort((a, b) => b.purchasedAt - a.purchasedAt),
      utilityTotal,
      utilityPurchases: [...utilityPurchases].sort((a, b) => b.purchasedAt - a.purchasedAt),
      allPurchases: [...list].sort((a, b) => b.purchasedAt - a.purchasedAt),
    };
  });
}

/**
 * Detects whether purchases with the same date (YYYY-MM-DD in local time)
 * and the exact same priceTotal already exist in the given purchases.
 */
export function findDuplicatePurchases<T extends { purchasedAt: number; priceTotal: number | null }>(
  purchases: T[],
  date: string,
  price: number,
): T[] {
  if (!price || price <= 0) return [];
  return purchases.filter(
    (p) => epochSecondsToDateInput(p.purchasedAt) === date && p.priceTotal === price,
  );
}

export interface HistoryDuplicateMatch<T> {
  matchedPurchase: T;
  amount: number;
  reason: "item_price" | "bill_total" | "sum_total";
}

/**
 * Checks whether newly entered or updated prices on a specific date collide
 * with an already recorded purchase on that same date.
 */
export function findHistoryDuplicate<T extends { id: string; priceTotal: number | null }>(
  allDatePurchases: T[],
  newAllocations: Record<string, number | undefined>,
  billTotal: number | null,
): HistoryDuplicateMatch<T> | null {
  // Purchases that were ALREADY recorded with a positive price before this edit session
  const previouslyPriced = allDatePurchases.filter(
    (p) => p.priceTotal !== null && p.priceTotal > 0,
  );

  if (previouslyPriced.length === 0) return null;

  // 1. Check if billTotal matches an existing recorded purchase
  if (billTotal !== null && billTotal > 0) {
    const match = previouslyPriced.find((p) => p.priceTotal === billTotal);
    if (match) {
      return { matchedPurchase: match, amount: billTotal, reason: "bill_total" };
    }
  }

  // 2. Check each newly allocated price against previously recorded purchases
  let newlyPricedSum = 0;
  let newlyPricedCount = 0;

  for (const p of allDatePurchases) {
    const allocatedPrice = newAllocations[p.id];
    // Only check if price is newly provided or modified
    if (allocatedPrice !== undefined && allocatedPrice > 0 && allocatedPrice !== p.priceTotal) {
      newlyPricedSum += allocatedPrice;
      newlyPricedCount++;

      const match = previouslyPriced.find(
        (existing) => existing.id !== p.id && existing.priceTotal === allocatedPrice,
      );
      if (match) {
        return { matchedPurchase: match, amount: allocatedPrice, reason: "item_price" };
      }
    }
  }

  // 3. If multiple items are being priced, check if their sum matches an existing recorded purchase
  if (newlyPricedCount > 1 && newlyPricedSum > 0) {
    const match = previouslyPriced.find((existing) => existing.priceTotal === newlyPricedSum);
    if (match) {
      return { matchedPurchase: match, amount: newlyPricedSum, reason: "sum_total" };
    }
  }

  return null;
}



