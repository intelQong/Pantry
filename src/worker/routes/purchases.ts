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

/** How far back a client is allowed to backdate a purchase. */
const BACKDATE_WINDOW_SECONDS = 30 * 86400;

/** purchased_at is epoch seconds: must be absent, or a positive integer. */
function isValidPurchasedAt(value: unknown): value is number | undefined {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * The moment a purchase actually happened.
 *
 * Shopping happens in shops, and shops are where phones lose signal, so a buy
 * can be queued offline and sync hours or days later. Stamping it with the
 * server clock at sync time would tell the restock engine the shop happened
 * when the wifi came back -- dragging every learned interval and due date along
 * with it, silently and unrecoverably.
 *
 * The value is client-supplied and so untrusted, but a phone with a skewed
 * clock still has to be able to sync. So it is clamped rather than rejected:
 * never in the future, never further back than the backdate window.
 */
function resolvePurchasedAt(value: number | undefined, now: number): number {
  if (value === undefined) return now;
  return Math.min(now, Math.max(now - BACKDATE_WINDOW_SECONDS, value));
}

purchases.post("/list/:id/bought", requireMember, async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");

  const entry = await c.env.DB.prepare(
    "SELECT id, item_id, custom_name, qty FROM list_entry WHERE id = ? AND household_id = ?",
  )
    .bind(id, session.householdId)
    .first<{ id: string; item_id: string | null; custom_name: string | null; qty: number | null }>();

  if (!entry) {
    return c.json({ error: "not_found", message: "No such list entry." }, 404);
  }

  const body = await c.req.json<{
    qty?: number;
    priceTotal?: number | null;
    note?: string | null;
    purchasedAt?: number;
  }>();
  if (!isValidPriceTotal(body.priceTotal)) {
    return c.json(
      { error: "invalid_price", message: "priceTotal must be a non-negative whole number of minor units." },
      400,
    );
  }
  if (!isValidPurchasedAt(body.purchasedAt)) {
    return c.json(
      { error: "invalid_purchased_at", message: "purchasedAt must be a whole number of seconds since 1970." },
      400,
    );
  }

  const now = nowSeconds();
  const purchasedAt = resolvePurchasedAt(body.purchasedAt, now);
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

  // Custom_name entries get an item created at purchase time, so the item only
  // enters the pantry when actually bought. The item_id is linked back to the
  // list_entry within the same batch so the purchase rows reference it.
  let itemIdForPurchase = entry.item_id;
  if (!itemIdForPurchase && entry.custom_name) {
    const newItemId = crypto.randomUUID();
    try {
      await c.env.DB.prepare(
        `INSERT INTO item (id, household_id, name, created_by, created_at, last_purchased_at)
         VALUES (?,?,?,?,?,?)`,
      ).bind(newItemId, session.householdId, entry.custom_name, session.memberId, now, purchasedAt).run();
      itemIdForPurchase = newItemId;
    } catch (err) {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM item WHERE household_id = ? AND name = ? AND archived = 0",
      ).bind(session.householdId, entry.custom_name).first<{ id: string }>();
      if (!existing) throw err;
      itemIdForPurchase = existing.id;
    }

    statements.push(
      c.env.DB.prepare(
        `UPDATE list_entry SET item_id = ?, custom_name = NULL
          WHERE id = ? AND household_id = ? AND ${stillPending}`,
      ).bind(itemIdForPurchase, id, session.householdId, id, session.householdId),
    );
  }

  if (itemIdForPurchase) {
    const item = await c.env.DB.prepare(
      "SELECT unit, default_qty FROM item WHERE id = ? AND household_id = ?",
    )
      .bind(itemIdForPurchase, session.householdId)
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
          itemIdForPurchase,
          purchasedAt,
          qty,
          item.unit,
          body.priceTotal ?? null,
          session.memberId,
          body.note ?? null,
          id,
          session.householdId,
        ),
        // MAX rather than a plain set: a backdated buy syncing late must not
        // wind the restock clock backwards past a more recent purchase. SQLite's
        // two-argument max() returns NULL if either side is, hence the COALESCE
        // for an item that has never been bought.
        c.env.DB.prepare(
          `UPDATE item SET last_purchased_at = MAX(COALESCE(last_purchased_at, 0), ?)
            WHERE id = ? AND household_id = ? AND ${stillPending}`,
        ).bind(purchasedAt, itemIdForPurchase, session.householdId, id, session.householdId),
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
  if (itemIdForPurchase) {
    await relearnInterval(c.env.DB, itemIdForPurchase, session.householdId);
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
    purchasedAt?: number;
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
  if (!isValidPurchasedAt(body.purchasedAt)) {
    return c.json(
      { error: "invalid_purchased_at", message: "purchasedAt must be a whole number of seconds since 1970." },
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
  const purchasedAt = resolvePurchasedAt(body.purchasedAt, now);
  const id = crypto.randomUUID();
  const qty = body.qty ?? item.default_qty;
  const unit = body.unit?.trim() || item.unit;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO purchase (id, household_id, item_id, purchased_at, qty, unit, price_total, bought_by, note)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(id, session.householdId, body.itemId, purchasedAt, qty, unit, body.priceTotal ?? null, session.memberId, body.note ?? null),
    // MAX for the same reason as in /list/:id/bought above.
    c.env.DB.prepare(
      "UPDATE item SET last_purchased_at = MAX(COALESCE(last_purchased_at, 0), ?) WHERE id = ? AND household_id = ?",
    ).bind(purchasedAt, body.itemId, session.householdId),
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
       FROM purchase WHERE item_id = ? AND household_id = ?
      ORDER BY purchased_at DESC`,
  )
    .bind(itemId, session.householdId)
    .all<PurchaseRow>();

  return c.json(rows.results.map(toPurchase));
});

export default purchases;
