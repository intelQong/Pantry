import { Hono } from "hono";
import type { AppEnv } from "../env";
import { nowSeconds } from "../env";
import { requireSession, requireMember } from "../middleware";
import { relearnInterval } from "../restock";
import type { Purchase } from "../../shared/types";

const purchases = new Hono<AppEnv>();

interface PurchaseRow {
  id: string;
  item_id: string;
  purchased_at: number;
  qty: number;
  unit: string;
  price_total: number | null;
  bought_by: string | null;
  note: string | null;
}

function toPurchase(row: PurchaseRow): Purchase {
  return {
    id: row.id,
    itemId: row.item_id,
    purchasedAt: row.purchased_at,
    qty: row.qty,
    unit: row.unit,
    priceTotal: row.price_total,
    boughtBy: row.bought_by,
    note: row.note,
  };
}

/** price_total is minor units (poisha): must be absent, or a non-negative integer. */
function isValidPriceTotal(value: unknown): value is number | null | undefined {
  if (value === undefined || value === null) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

purchases.post("/list/:id/bought", requireMember, async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");

  const entry = await c.env.DB.prepare(
    "SELECT id, item_id, qty FROM list_entry WHERE id = ? AND household_id = ?",
  )
    .bind(id, session.householdId)
    .first<{ id: string; item_id: string | null; qty: number | null }>();

  if (!entry) {
    return c.json({ error: "not_found", message: "No such list entry." }, 404);
  }

  const body = await c.req.json<{ qty?: number; priceTotal?: number | null; note?: string | null }>();
  if (!isValidPriceTotal(body.priceTotal)) {
    return c.json(
      { error: "invalid_price", message: "priceTotal must be a non-negative whole number of minor units." },
      400,
    );
  }

  const now = nowSeconds();
  const statements: D1PreparedStatement[] = [];
  let purchaseId: string | null = null;

  // Every statement below is guarded by the entry still being 'pending', and
  // the guard is checked *before* the status flip at the end. That makes the
  // whole endpoint idempotent: a double-tap in Shop Mode, or a retry over
  // flaky shop wifi, no-ops instead of logging the purchase twice. Duplicate
  // purchases would silently corrupt both the learned restock interval and the
  // spend totals, and nothing downstream could tell them from a real repeat buy.
  const stillPending = `EXISTS (SELECT 1 FROM list_entry
                                 WHERE id = ? AND household_id = ? AND status = 'pending')`;

  // A custom_name entry has no item_id -- there's nothing to log a purchase
  // against, so it just resolves off the list. That's expected, not a bug.
  if (entry.item_id) {
    const item = await c.env.DB.prepare(
      "SELECT unit, default_qty FROM item WHERE id = ? AND household_id = ?",
    )
      .bind(entry.item_id, session.householdId)
      .first<{ unit: string; default_qty: number }>();

    if (item) {
      purchaseId = crypto.randomUUID();
      const qty = body.qty ?? entry.qty ?? item.default_qty;
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO purchase (id, household_id, item_id, purchased_at, qty, unit, price_total, bought_by, note)
           SELECT ?,?,?,?,?,?,?,?,? WHERE ${stillPending}`,
        ).bind(
          purchaseId,
          session.householdId,
          entry.item_id,
          now,
          qty,
          item.unit,
          body.priceTotal ?? null,
          session.memberId,
          body.note ?? null,
          id,
          session.householdId,
        ),
        c.env.DB.prepare(
          `UPDATE item SET last_purchased_at = ?
            WHERE id = ? AND household_id = ? AND ${stillPending}`,
        ).bind(now, entry.item_id, session.householdId, id, session.householdId),
      );
    }
  }

  // Flipping the status must come last, so the guards above still see 'pending'
  // within this transaction.
  statements.push(
    c.env.DB.prepare(
      `UPDATE list_entry SET status = 'bought', resolved_at = ?
        WHERE id = ? AND household_id = ? AND status = 'pending'`,
    ).bind(now, id, session.householdId),
  );

  // D1 runs a batch as a single implicit transaction, so the purchase row, the
  // item stamp, and the status flip all land together or not at all.
  const results = await c.env.DB.batch(statements);
  const resolved = (results[results.length - 1]?.meta.changes ?? 0) > 0;

  if (!resolved) {
    // Already bought or skipped by the other phone. Report success without
    // having written anything -- the caller's intent is already satisfied.
    return c.json({ ok: true, purchaseId: null, alreadyResolved: true });
  }

  // Relearning runs after the batch, not inside it: it's a read-then-maybe-write
  // against the same item row, and folding it into the D1 batch above would
  // buy nothing (the batch already committed) while making the batch itself
  // harder to reason about.
  if (entry.item_id) {
    await relearnInterval(c.env.DB, entry.item_id, session.householdId);
  }

  return c.json({ ok: true, purchaseId, alreadyResolved: false });
});

purchases.post("/purchases", requireMember, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{
    itemId?: string;
    qty?: number;
    unit?: string;
    priceTotal?: number | null;
    note?: string | null;
  }>();

  if (!body.itemId) {
    return c.json({ error: "missing_item", message: "itemId is required." }, 400);
  }
  if (!isValidPriceTotal(body.priceTotal)) {
    return c.json(
      { error: "invalid_price", message: "priceTotal must be a non-negative whole number of minor units." },
      400,
    );
  }

  const item = await c.env.DB.prepare(
    "SELECT unit, default_qty FROM item WHERE id = ? AND household_id = ?",
  )
    .bind(body.itemId, session.householdId)
    .first<{ unit: string; default_qty: number }>();

  if (!item) {
    return c.json({ error: "unknown_item", message: "That item doesn't exist." }, 400);
  }

  const now = nowSeconds();
  const id = crypto.randomUUID();
  const qty = body.qty ?? item.default_qty;
  const unit = body.unit?.trim() || item.unit;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO purchase (id, household_id, item_id, purchased_at, qty, unit, price_total, bought_by, note)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(id, session.householdId, body.itemId, now, qty, unit, body.priceTotal ?? null, session.memberId, body.note ?? null),
    c.env.DB.prepare("UPDATE item SET last_purchased_at = ? WHERE id = ? AND household_id = ?").bind(
      now,
      body.itemId,
      session.householdId,
    ),
  ]);

  // Runs after the batch above, same reasoning as in POST /list/:id/bought.
  await relearnInterval(c.env.DB, body.itemId, session.householdId);

  const row = await c.env.DB.prepare(
    `SELECT id, item_id, purchased_at, qty, unit, price_total, bought_by, note
       FROM purchase WHERE id = ?`,
  )
    .bind(id)
    .first<PurchaseRow>();

  return c.json(toPurchase(row!), 201);
});

purchases.get("/items/:id/purchases", requireSession, async (c) => {
  const session = c.get("session");
  const itemId = c.req.param("id");

  const item = await c.env.DB.prepare("SELECT id FROM item WHERE id = ? AND household_id = ?")
    .bind(itemId, session.householdId)
    .first();
  if (!item) {
    return c.json({ error: "not_found", message: "No such item." }, 404);
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, item_id, purchased_at, qty, unit, price_total, bought_by, note
       FROM purchase WHERE item_id = ? ORDER BY purchased_at DESC`,
  )
    .bind(itemId)
    .all<PurchaseRow>();

  return c.json(rows.results.map(toPurchase));
});

export default purchases;
