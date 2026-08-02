import { Hono } from "hono";
import type { AppEnv } from "../env";
import { nowSeconds } from "../env";
import { requireSession, requireMember } from "../middleware";
import { computeStatus, byUrgency } from "../restock";
import type { Item, Category, ItemWithStatus } from "../../shared/types";

const items = new Hono<AppEnv>();

/** How far ahead of due an item starts showing as due_soon, absent a member profile. */
const DEFAULT_LEAD_DAYS = 2;

/**
 * default_price is minor units (poisha), so it must be a non-negative integer.
 * Rejecting floats here is what keeps 12.5 poisha from ever reaching the
 * database and quietly breaking every total downstream.
 */
function isValidPrice(value: unknown): value is number | null | undefined {
  if (value === undefined || value === null) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

interface ItemRow {
  id: string;
  name: string;
  category_id: string | null;
  unit: string;
  default_qty: number;
  brand: string | null;
  notes: string | null;
  is_staple: number;
  default_price: number | null;
  restock_interval_days: number;
  interval_locked: number;
  last_purchased_at: number | null;
  archived: number;
  created_at: number;
  /** 1 when the item sits in the Utilities category; NULL when uncategorised. */
  is_utility: number | null;
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    unit: row.unit,
    defaultQty: row.default_qty,
    brand: row.brand,
    notes: row.notes,
    isStaple: row.is_staple === 1,
    defaultPrice: row.default_price,
    restockIntervalDays: row.restock_interval_days,
    intervalLocked: row.interval_locked === 1,
    lastPurchasedAt: row.last_purchased_at,
    archived: row.archived === 1,
    isUtility: row.is_utility === 1,
  };
}

function toItemWithStatus(row: ItemRow, leadDays: number, now: number, onList: boolean): ItemWithStatus {
  const { status, daysSince, daysUntilDue } = computeStatus(row, leadDays, now);
  return { ...toItem(row), status, daysSince, daysUntilDue, onList };
}

// A correlated subquery rather than a join, so every query that selects these
// columns keeps working with a bare `FROM item` -- including the single-row
// fetches after a create or a patch.
const ITEM_COLUMNS = `id, name, category_id, unit, default_qty, brand, notes, is_staple,
            default_price, restock_interval_days, interval_locked, last_purchased_at,
            archived, created_at,
            (SELECT c.name = 'Utilities' FROM category c WHERE c.id = item.category_id) AS is_utility`;

/** The item ids currently sitting on the household's pending shop list. */
async function pendingItemIds(db: D1Database, householdId: string): Promise<Set<string>> {
  const rows = await db
    .prepare("SELECT item_id FROM list_entry WHERE household_id = ? AND status = 'pending' AND item_id IS NOT NULL")
    .bind(householdId)
    .all<{ item_id: string }>();
  return new Set(rows.results.map((r) => r.item_id));
}

/** lead_days is per-member; sessions with no profile chosen yet fall back to the schema default. */
async function leadDaysFor(db: D1Database, memberId: string | null): Promise<number> {
  if (!memberId) return DEFAULT_LEAD_DAYS;
  const settings = await db
    .prepare("SELECT lead_days FROM member_settings WHERE member_id = ?")
    .bind(memberId)
    .first<{ lead_days: number }>();
  return settings?.lead_days ?? DEFAULT_LEAD_DAYS;
}

/** All non-archived items for the household, with live restock status attached. */
items.get("/items", requireSession, async (c) => {
  const session = c.get("session");
  const now = nowSeconds();

  const [rows, leadDays, onList] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ${ITEM_COLUMNS}
         FROM item
        WHERE household_id = ?
        ORDER BY name`,
    )
      .bind(session.householdId)
      .all<ItemRow>(),
    leadDaysFor(c.env.DB, session.memberId),
    pendingItemIds(c.env.DB, session.householdId),
  ]);

  return c.json(rows.results.map((row) => toItemWithStatus(row, leadDays, now, onList.has(row.id))));
});

/** Every staple that needs attention, most urgent first -- the "what do I need to buy" screen. */
items.get("/today", requireMember, async (c) => {
  const session = c.get("session");
  const now = nowSeconds();

  const [rows, leadDays, onList] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ${ITEM_COLUMNS}
         FROM item
        WHERE household_id = ? AND is_staple = 1`,
    )
      .bind(session.householdId)
      .all<ItemRow>(),
    // requireMember guarantees session.memberId is set.
    leadDaysFor(c.env.DB, session.memberId),
    pendingItemIds(c.env.DB, session.householdId),
  ]);

  // Utilities are staples by every mechanical measure -- they have an interval,
  // they go due, they push -- but Today is the "what do I buy at the shop"
  // screen, and nobody buys a wifi bill at the shop. They live on Bills.
  const withStatus = rows.results
    .filter((row) => row.is_utility !== 1)
    .map((row) => toItemWithStatus(row, leadDays, now, onList.has(row.id)));
  withStatus.sort(byUrgency);

  return c.json(withStatus);
});

items.post("/items", requireMember, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{
    name?: string;
    categoryId?: string | null;
    unit?: string;
    defaultQty?: number;
    brand?: string | null;
    notes?: string | null;
    isStaple?: boolean;
    defaultPrice?: number | null;
    restockIntervalDays?: number;
    intervalLocked?: boolean;
  }>();

  const name = body.name?.trim();
  if (!name) {
    return c.json({ error: "missing_name", message: "An item needs a name." }, 400);
  }

  if (!isValidPrice(body.defaultPrice)) {
    return c.json(
      { error: "invalid_price", message: "Price must be a whole number of poisha, or empty." },
      400,
    );
  }

  if (body.categoryId) {
    const category = await c.env.DB.prepare(
      "SELECT id FROM category WHERE id = ? AND household_id = ?",
    )
      .bind(body.categoryId, session.householdId)
      .first();
    if (!category) {
      return c.json({ error: "unknown_category", message: "That category doesn't exist." }, 400);
    }
  }

  const id = crypto.randomUUID();
  const now = nowSeconds();

  try {
    await c.env.DB.prepare(
      `INSERT INTO item (
         id, household_id, name, category_id, unit, default_qty, brand, notes,
         is_staple, default_price, restock_interval_days, interval_locked,
         created_by, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id,
        session.householdId,
        name,
        body.categoryId ?? null,
        body.unit?.trim() || "pcs",
        typeof body.defaultQty === "number" && Number.isFinite(body.defaultQty) ? body.defaultQty : 1,
        body.brand?.trim() || null,
        body.notes?.trim() || null,
        body.isStaple === false ? 0 : 1,
        body.defaultPrice ?? null,
        Number.isInteger(body.restockIntervalDays) && body.restockIntervalDays! > 0
          ? body.restockIntervalDays
          : 7,
        body.intervalLocked === true ? 1 : 0,
        // Guaranteed non-null: requireMember already rejected sessions with no profile.
        session.memberId,
        now,
      )
      .run();
  } catch (err) {
    // Active items are unique by name within a household (idx_item_unique_name).
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      return c.json(
        { error: "duplicate_item", message: "An item with that name already exists." },
        409,
      );
    }
    throw err;
  }

  const row = await c.env.DB.prepare(
    `SELECT ${ITEM_COLUMNS} FROM item WHERE id = ? AND household_id = ?`,
  )
    .bind(id, session.householdId)
    .first<ItemRow>();

  return c.json(toItem(row!), 201);
});

items.patch("/items/:id", requireSession, async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");

  const existing = await c.env.DB.prepare("SELECT id FROM item WHERE id = ? AND household_id = ?")
    .bind(id, session.householdId)
    .first();
  if (!existing) {
    return c.json({ error: "not_found", message: "No such item." }, 404);
  }

  const body = await c.req.json<{
    name?: string;
    categoryId?: string | null;
    unit?: string;
    defaultQty?: number;
    brand?: string | null;
    notes?: string | null;
    isStaple?: boolean;
    defaultPrice?: number | null;
    restockIntervalDays?: number;
    intervalLocked?: boolean;
  }>();

  if (!isValidPrice(body.defaultPrice)) {
    return c.json(
      { error: "invalid_price", message: "Price must be a whole number of poisha, or empty." },
      400,
    );
  }

  if (body.categoryId) {
    const category = await c.env.DB.prepare(
      "SELECT id FROM category WHERE id = ? AND household_id = ?",
    )
      .bind(body.categoryId, session.householdId)
      .first();
    if (!category) {
      return c.json({ error: "unknown_category", message: "That category doesn't exist." }, 400);
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return c.json({ error: "missing_name", message: "An item needs a name." }, 400);
    }
    set("name", trimmed);
  }
  if (body.categoryId !== undefined) set("category_id", body.categoryId);
  if (body.unit !== undefined) set("unit", body.unit.trim() || "pcs");
  if (body.defaultQty !== undefined) set("default_qty", body.defaultQty);
  if (body.brand !== undefined) set("brand", body.brand?.trim() || null);
  if (body.notes !== undefined) set("notes", body.notes?.trim() || null);
  if (body.isStaple !== undefined) set("is_staple", body.isStaple ? 1 : 0);
  if (body.defaultPrice !== undefined) set("default_price", body.defaultPrice);
  if (body.restockIntervalDays !== undefined) set("restock_interval_days", body.restockIntervalDays);
  if (body.intervalLocked !== undefined) set("interval_locked", body.intervalLocked ? 1 : 0);

  if (sets.length > 0) {
    values.push(id, session.householdId);
    try {
      await c.env.DB.prepare(
        `UPDATE item SET ${sets.join(", ")} WHERE id = ? AND household_id = ?`,
      )
        .bind(...values)
        .run();
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        return c.json(
          { error: "duplicate_item", message: "An item with that name already exists." },
          409,
        );
      }
      throw err;
    }
  }

  const row = await c.env.DB.prepare(
    `SELECT ${ITEM_COLUMNS} FROM item WHERE id = ? AND household_id = ?`,
  )
    .bind(id, session.householdId)
    .first<ItemRow>();

  return c.json(toItem(row!));
});

/** Soft delete only -- purchase history references item_id and must survive. */
items.delete("/items/:id", requireSession, async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");

  const result = await c.env.DB.prepare(
    "DELETE FROM item WHERE id = ? AND household_id = ?",
  )
    .bind(id, session.householdId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: "not_found", message: "No such item." }, 404);
  }

  return c.json({ ok: true });
});

items.get("/categories", requireSession, async (c) => {
  const session = c.get("session");
  const rows = await c.env.DB.prepare(
    "SELECT id, name, color, sort_order FROM category WHERE household_id = ? ORDER BY sort_order",
  )
    .bind(session.householdId)
    .all<{ id: string; name: string; color: string; sort_order: number }>();

  const categories: Category[] = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    sortOrder: r.sort_order,
  }));

  return c.json(categories);
});

export default items;
