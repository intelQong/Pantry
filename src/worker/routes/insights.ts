import { Hono } from "hono";
import type { AppEnv } from "../env";
import { nowSeconds } from "../env";
import { requireSession } from "../middleware";
import { medianGapDays, localParts } from "../restock";
import type {
  InsightsResponse,
  ItemUsage,
  CategorySpend,
  SpendBucket,
} from "../../shared/types";

const insights = new Hono<AppEnv>();

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** '2026-07' -> 'Jul'. Built from the string, not a Date, to avoid timezone drift. */
function monthLabel(key: string): string {
  const month = Number(key.slice(5, 7));
  return MONTHS[month - 1] ?? key;
}

/** '2026-07-21' -> '21 Jul'. */
function weekLabel(key: string): string {
  const month = Number(key.slice(5, 7));
  return `${Number(key.slice(8, 10))} ${MONTHS[month - 1] ?? ""}`.trim();
}

/** '2026-07-21' -> '21 Jul'. */
function dayLabel(key: string): string {
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  return `${day} ${MONTHS[month - 1] ?? ""}`.trim();
}

const DAY = 86_400;

interface Bucket {
  key: string;
  spend: number;
  purchases: number;
}

/** The Monday starting the week of a 'YYYY-MM-DD' date. Weeks run Monday-to-Sunday. */
function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Sums day buckets into coarser ones keyed by `keyOf`. */
function rollUp(days: Bucket[], keyOf: (date: string) => string): Bucket[] {
  const out = new Map<string, Bucket>();
  for (const d of days) {
    const key = keyOf(d.key);
    const b = out.get(key) ?? { key, spend: 0, purchases: 0 };
    b.spend += d.spend;
    b.purchases += d.purchases;
    out.set(key, b);
  }
  return [...out.values()];
}

/** The `limit` most recent buckets, newest first -- what the chart shows. */
const newest = (buckets: Bucket[], limit: number) =>
  [...buckets].sort((a, b) => b.key.localeCompare(a.key)).slice(0, limit);

interface UsageRow {
  item_id: string;
  name: string;
  unit: string;
  category_id: string | null;
  purchases: number;
  total_qty: number;
  total_spend: number | null;
  first_at: number;
  last_at: number;
}

/**
 * Household-wide consumption and spend.
 *
 * Everything here reads the `purchase` table, which is written only when an
 * item is ticked off the list or logged directly. Free-text list entries have
 * no item_id and so record nothing -- that is deliberate, but it means the
 * numbers below describe tracked staples only.
 *
 * Aggregation happens in SQL rather than by pulling rows into the Worker: a
 * household accumulates a few thousand purchases over years, and shipping all
 * of them over the wire to sum in JS would be the one query that eventually
 * gets slow.
 */
insights.get("/insights", requireSession, async (c) => {
  const { householdId, memberId } = c.get("session");
  const now = nowSeconds();
  const since30 = now - 30 * DAY;

  // Buckets follow the viewer's own calendar, as History's do (it groups in the
  // phone's local time). UTC buckets put a 2am Dhaka shop on the day before.
  const settings = memberId
    ? await c.env.DB.prepare("SELECT timezone FROM member_settings WHERE member_id = ?")
        .bind(memberId)
        .first<{ timezone: string }>()
    : null;
  const timeZone = settings?.timezone ?? "Asia/Dhaka";

  const [totals, recent, usage, byCategory, blocks] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n,
              COUNT(price_total) AS priced,
              COALESCE(SUM(price_total), 0) AS spend
         FROM purchase WHERE household_id = ?`,
    )
      .bind(householdId)
      .first<{ n: number; priced: number; spend: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(price_total), 0) AS spend
         FROM purchase WHERE household_id = ? AND purchased_at >= ?`,
    )
      .bind(householdId, since30)
      .first<{ n: number; spend: number }>(),

    c.env.DB.prepare(
      `SELECT p.item_id, i.name, i.unit, i.category_id,
              COUNT(*) AS purchases,
              COALESCE(SUM(p.qty), 0) AS total_qty,
              SUM(p.price_total) AS total_spend,
              MIN(p.purchased_at) AS first_at,
              MAX(p.purchased_at) AS last_at
         FROM purchase p
         JOIN item i ON i.id = p.item_id
        WHERE p.household_id = ?
        GROUP BY p.item_id
        ORDER BY purchases DESC, total_qty DESC
        LIMIT 20`,
    )
      .bind(householdId)
      .all<UsageRow>(),

    c.env.DB.prepare(
      `SELECT i.category_id,
              COALESCE(c.name, 'Uncategorised') AS name,
              COALESCE(c.color, '#94a3b8') AS color,
              COALESCE(SUM(p.price_total), 0) AS spend,
              COUNT(*) AS purchases
         FROM purchase p
         JOIN item i ON i.id = p.item_id
         LEFT JOIN category c ON c.id = i.category_id
        WHERE p.household_id = ?
        GROUP BY i.category_id
        ORDER BY spend DESC`,
    )
      .bind(householdId)
      .all<{
        category_id: string | null;
        name: string;
        color: string;
        spend: number;
        purchases: number;
      }>(),

    // SQLite has no timezone database, and one offset for the whole history
    // is wrong for every purchase on the far side of a daylight-saving change.
    // So SQL only collapses purchases into 15-minute blocks -- every real UTC
    // offset is a multiple of 15 minutes, so no block straddles a local
    // midnight -- and each block's local date is worked out with Intl below.
    // A household shops a handful of times a week, so this stays a few
    // hundred rows however much history piles up.
    c.env.DB.prepare(
      `SELECT (purchased_at / 900) * 900 AS block,
              COALESCE(SUM(price_total), 0) AS spend,
              COUNT(*) AS purchases
         FROM purchase WHERE household_id = ?
        GROUP BY block`,
    )
      .bind(householdId)
      .all<{ block: number; spend: number; purchases: number }>(),
  ]);

  const byDayMap = new Map<string, { spend: number; purchases: number }>();
  for (const b of blocks.results) {
    const { date } = localParts(b.block, timeZone);
    const bucket = byDayMap.get(date) ?? { spend: 0, purchases: 0 };
    bucket.spend += b.spend;
    bucket.purchases += b.purchases;
    byDayMap.set(date, bucket);
  }
  const days = [...byDayMap].map(([key, v]) => ({ key, ...v }));
  const byDay = newest(days, 30);
  const byWeek = newest(rollUp(days, weekStart), 12);
  const byMonth = newest(rollUp(days, (d) => d.slice(0, 7)), 12);

  // Per-item rhythm needs the individual timestamps, which the GROUP BY above
  // has already collapsed. One extra query for the items actually being shown.
  const itemIds = usage.results.map((r) => r.item_id);
  const gapsByItem = new Map<string, number | null>();

  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => "?").join(",");
    const stamps = await c.env.DB.prepare(
      `SELECT item_id, purchased_at FROM purchase
        WHERE household_id = ? AND item_id IN (${placeholders})
        ORDER BY item_id, purchased_at`,
    )
      .bind(householdId, ...itemIds)
      .all<{ item_id: string; purchased_at: number }>();

    const grouped = new Map<string, number[]>();
    for (const row of stamps.results) {
      const list = grouped.get(row.item_id) ?? [];
      list.push(row.purchased_at);
      grouped.set(row.item_id, list);
    }
    for (const [id, times] of grouped) gapsByItem.set(id, medianGapDays(times));
  }

  const topItems: ItemUsage[] = usage.results.map((row) => {
    // Rate needs a span to divide by. A single purchase has none, and two
    // purchases a day apart would extrapolate to something absurd, so the rate
    // stays null until there is at least a week of history to reason from.
    const spanDays = (row.last_at - row.first_at) / DAY;
    const qtyPerMonth =
      row.purchases >= 2 && spanDays >= 7
        ? Number(((row.total_qty / spanDays) * 30).toFixed(2))
        : null;

    return {
      itemId: row.item_id,
      name: row.name,
      unit: row.unit,
      categoryId: row.category_id,
      purchases: row.purchases,
      totalQty: row.total_qty,
      totalSpend: row.total_spend ?? 0,
      firstPurchaseAt: row.first_at,
      lastPurchaseAt: row.last_at,
      qtyPerMonth,
      medianGapDays: (() => {
        const gap = gapsByItem.get(row.item_id);
        return gap === null || gap === undefined ? null : Number(gap.toFixed(1));
      })(),
    };
  });

  const body: InsightsResponse = {
    hasData: (totals?.n ?? 0) > 0,
    totalPurchases: totals?.n ?? 0,
    pricedPurchases: totals?.priced ?? 0,
    totalSpend: totals?.spend ?? 0,
    spendLast30: recent?.spend ?? 0,
    purchasesLast30: recent?.n ?? 0,
    byCategory: byCategory.results.map(
      (r): CategorySpend => ({
        categoryId: r.category_id,
        name: r.name,
        color: r.color,
        spend: r.spend,
        purchases: r.purchases,
      }),
    ),
    byMonth: byMonth.map((r): SpendBucket => ({ ...r, label: monthLabel(r.key) })),
    byWeek: byWeek.map((r): SpendBucket => ({ ...r, label: weekLabel(r.key) })),
    byDay: byDay.map((r): SpendBucket => ({ ...r, label: dayLabel(r.key) })),
    topItems,
  };

  return c.json(body);
});

export default insights;
