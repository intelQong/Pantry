import { Hono } from "hono";
import type { AppEnv } from "../env";
import { nowSeconds } from "../env";
import { requireSession, requireMember } from "../middleware";
import { relearnInterval } from "../restock";
import { auditStatement } from "../audit";
// Pure and dependency-free, so the audit summary shows money exactly as the app does.
import { formatMoney } from "../../client/lib/money";
import { notifyListActivity } from "../activity";
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
export function isValidPriceTotal(value: unknown): value is number | null | undefined {
  if (value === undefined || value === null) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * qty is a REAL column, so anything numeric binds happily -- including
 * Infinity, which JSON.parse produces from `1e400` and which then poisons every
 * SUM(qty) that item appears in, permanently and invisibly. Must be absent, or
 * a finite positive number.
 */
export function isValidQty(value: unknown): value is number | undefined {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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

/**
 * The item a typed name refers to, case-insensitively -- the same rule the shop
 * list merges by, so "rice" typed on the list and "Rice" in the pantry are one
 * item, not a twin that splits the purchase history and the learned interval.
 */
async function findItemByName(db: D1Database, householdId: string, name: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM item WHERE household_id = ? AND LOWER(name) = LOWER(?) ORDER BY rowid LIMIT 1")
    .bind(householdId, name)
    .first<{ id: string }>();
  return row?.id ?? null;
}

purchases.post("/list/:id/bought", requireMember, async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");

  const entry = await c.env.DB.prepare(
    "SELECT id, item_id, custom_name, qty, status FROM list_entry WHERE id = ? AND household_id = ?",
  )
    .bind(id, session.householdId)
    .first<{
      id: string;
      item_id: string | null;
      custom_name: string | null;
      qty: number | null;
      status: string;
    }>();

  if (!entry) {
    return c.json({ error: "not_found", message: "No such list entry." }, 404);
  }

  // Every write below is guarded by the entry still being pending, except the
  // item creation for a free-text entry -- that one runs on its own, before the
  // batch, so it has to be stopped here instead. Without this, a queued buy
  // arriving after the other phone skipped the entry would leave a real pantry
  // item behind: stamped as just purchased, with no purchase row to show for
  // it, nagging in a week and holding the name against a later genuine add.
  if (entry.status !== "pending") {
    return c.json({ ok: true, purchaseId: null, alreadyResolved: true });
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
  if (!isValidQty(body.qty)) {
    return c.json({ error: "invalid_qty", message: "qty must be a positive number." }, 400);
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
    itemIdForPurchase = await findItemByName(c.env.DB, session.householdId, entry.custom_name);
    if (!itemIdForPurchase) {
      const newItemId = crypto.randomUUID();
      try {
        await c.env.DB.prepare(
          `INSERT INTO item (id, household_id, name, created_by, created_at, last_purchased_at)
           VALUES (?,?,?,?,?,?)`,
        ).bind(newItemId, session.householdId, entry.custom_name, session.memberId, now, purchasedAt).run();
        itemIdForPurchase = newItemId;
      } catch (err) {
        // Lost a race with another add of the same name; use the winner's row.
        itemIdForPurchase = await findItemByName(c.env.DB, session.householdId, entry.custom_name);
        if (!itemIdForPurchase) throw err;
      }
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
    const bought = await c.env.DB.prepare("SELECT name FROM item WHERE id = ? AND household_id = ?")
      .bind(itemIdForPurchase, session.householdId)
      .first<{ name: string }>();
    // Only a buy that actually resolved the entry gets here, so a double-tap
    // or a retry is never announced twice.
    if (bought) {
      c.executionCtx.waitUntil(
        notifyListActivity(c.env, session.householdId, session.memberId!, "bought", bought.name, now),
      );
    }
  }

  return c.json({ ok: true, purchaseId, alreadyResolved: false });
});

purchases.post("/purchases", requireMember, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{
    itemId?: string;
    itemName?: string;
    qty?: number;
    unit?: string;
    priceTotal?: number | null;
    note?: string | null;
    purchasedAt?: number;
  }>();

  // Validated before anything is written: an item created for a purchase that
  // then gets rejected would sit in the pantry with no history, nagging.
  if (!isValidPriceTotal(body.priceTotal)) {
    return c.json(
      { error: "invalid_price", message: "priceTotal must be a non-negative whole number of minor units." },
      400,
    );
  }
  if (!isValidQty(body.qty)) {
    return c.json({ error: "invalid_qty", message: "qty must be a positive number." }, 400);
  }
  if (!isValidPurchasedAt(body.purchasedAt)) {
    return c.json(
      { error: "invalid_purchased_at", message: "purchasedAt must be a whole number of seconds since 1970." },
      400,
    );
  }

  const now = nowSeconds();
  const purchasedAt = resolvePurchasedAt(body.purchasedAt, now);

  let itemId = body.itemId;
  if (!itemId) {
    const typedName = typeof body.itemName === "string" ? body.itemName.trim() : "";
    const rawName = typedName || "General expense";
    itemId = (await findItemByName(c.env.DB, session.householdId, rawName)) ?? undefined;
    if (!itemId) {
      itemId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO item (id, household_id, name, is_staple, unit, created_by, created_at, last_purchased_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          itemId,
          session.householdId,
          rawName,
          // A named thing is worth tracking; the catch-all bucket is not.
          typedName ? 1 : 0,
          body.unit?.trim() || "pcs",
          session.memberId,
          now,
          purchasedAt,
        )
        .run();
    }
  }

  const item = await c.env.DB.prepare(
    "SELECT unit, default_qty FROM item WHERE id = ? AND household_id = ?",
  )
    .bind(itemId, session.householdId)
    .first<{ unit: string; default_qty: number }>();

  if (!item) {
    return c.json({ error: "unknown_item", message: "That item doesn't exist." }, 400);
  }

  const id = crypto.randomUUID();
  const qty = body.qty ?? item.default_qty;
  const unit = body.unit?.trim() || item.unit;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO purchase (id, household_id, item_id, purchased_at, qty, unit, price_total, bought_by, note)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(id, session.householdId, itemId, purchasedAt, qty, unit, body.priceTotal ?? null, session.memberId, body.note ?? null),
    // MAX for the same reason as in /list/:id/bought above.
    c.env.DB.prepare(
      "UPDATE item SET last_purchased_at = MAX(COALESCE(last_purchased_at, 0), ?) WHERE id = ? AND household_id = ?",
    ).bind(purchasedAt, itemId, session.householdId),
  ]);

  // Runs after the batch above, same reasoning as in POST /list/:id/bought.
  await relearnInterval(c.env.DB, itemId, session.householdId);

  // A logged grocery spend is a purchase the other phone would want to know
  // about; a bill payment is not shopping, and Bills already shows it.
  const logged = await c.env.DB.prepare(
    `SELECT i.name, COALESCE(cat.name, '') = 'Utilities' AS is_utility
       FROM item i LEFT JOIN category cat ON cat.id = i.category_id
      WHERE i.id = ? AND i.household_id = ?`,
  )
    .bind(itemId, session.householdId)
    .first<{ name: string; is_utility: number }>();
  if (logged && logged.is_utility !== 1) {
    c.executionCtx.waitUntil(
      notifyListActivity(c.env, session.householdId, session.memberId!, "bought", logged.name, now),
    );
  }

  const row = await c.env.DB.prepare(
    `SELECT id, item_id, purchased_at, qty, unit, price_total, bought_by, note
       FROM purchase WHERE id = ? AND household_id = ?`,
  )
    .bind(id, session.householdId)
    .first<PurchaseRow>();

  return c.json(toPurchase(row!), 201);
});

/**
 * Corrects what was recorded for purchases already logged: quantities and
 * prices, nothing else.
 *
 * Takes a list rather than one id because splitting a receipt total across a
 * day rewrites every price on that day at once. D1 runs a batch as a single
 * transaction, so the whole day lands or none of it does -- a half-applied
 * split would leave the money spread across a shop that never happened.
 *
 * purchased_at is deliberately not editable here. It is the only field the
 * restock engine reads (src/worker/restock.ts), so leaving it alone means this
 * endpoint can never disturb a learned interval or a due date.
 */
purchases.patch("/purchases", requireMember, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{
    updates?: Array<{ id?: string; qty?: number; priceTotal?: number | null }>;
  }>();

  const updates = body.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return c.json({ error: "no_updates", message: "Send at least one update." }, 400);
  }

  const statements: D1PreparedStatement[] = [];
  for (const update of updates) {
    if (!update.id) {
      return c.json({ error: "missing_id", message: "Every update needs an id." }, 400);
    }
    if (!isValidPriceTotal(update.priceTotal)) {
      return c.json(
        { error: "invalid_price", message: "priceTotal must be a non-negative whole number of minor units." },
        400,
      );
    }
    if (!isValidQty(update.qty)) {
      return c.json({ error: "invalid_qty", message: "qty must be a positive number." }, 400);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    if (update.qty !== undefined) {
      sets.push("qty = ?");
      values.push(update.qty);
    }
    if (update.priceTotal !== undefined) {
      sets.push("price_total = ?");
      values.push(update.priceTotal);
    }
    if (sets.length === 0) continue;

    // Scoped to the household on the statement itself, so a guessed id from
    // another kitchen updates nothing rather than relying on a prior check.
    values.push(update.id, session.householdId);
    statements.push(
      c.env.DB.prepare(
        `UPDATE purchase SET ${sets.join(", ")} WHERE id = ? AND household_id = ?`,
      ).bind(...values),
    );
  }

  if (statements.length === 0) {
    return c.json({ error: "no_updates", message: "Nothing to change." }, 400);
  }

  const results = await c.env.DB.batch(statements);
  const changed = results.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
  return c.json({ ok: true, updated: changed });
});

/**
 * The whole household's buying history, newest first, for the History screen.
 *
 * Utilities are excluded on the same grounds they are excluded from Today and
 * Pantry: gas and wifi are paid, not shopped for, and the Bills screen already
 * has their log. The cap is generous enough to cover a couple of years of
 * weekly shopping and exists only so this can never become an unbounded read.
 */
purchases.get("/purchases", requireSession, async (c) => {
  const session = c.get("session");
  const includeAll = c.req.query("all") === "1" || c.req.query("all") === "true";

  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.item_id, p.purchased_at, p.qty, p.unit, p.price_total, p.bought_by, p.note,
            i.name AS item_name
       FROM purchase p
       JOIN item i ON i.id = p.item_id
       LEFT JOIN category cat ON cat.id = i.category_id
      WHERE p.household_id = ? ${includeAll ? "" : "AND COALESCE(cat.name, '') != 'Utilities'"}
      ORDER BY p.purchased_at DESC, p.rowid DESC
      LIMIT 500`,
  )
    .bind(session.householdId)
    .all<PurchaseRow & { item_name: string }>();

  return c.json(
    rows.results.map((row) => ({ ...toPurchase(row), itemName: row.item_name })),
  );
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

purchases.delete("/purchases/:id", requireMember, async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");

  const purchaseRow = await c.env.DB.prepare(
    `SELECT p.id, p.item_id, p.purchased_at, p.qty, p.unit, p.price_total, p.bought_by, p.note,
            i.name AS item_name
       FROM purchase p
       JOIN item i ON i.id = p.item_id
      WHERE p.id = ? AND p.household_id = ?`,
  )
    .bind(id, session.householdId)
    .first<{
      id: string;
      item_id: string;
      purchased_at: number;
      qty: number;
      unit: string;
      price_total: number | null;
      bought_by: string;
      note: string | null;
      item_name: string;
    }>();

  if (!purchaseRow) {
    return c.json({ error: "not_found", message: "Purchase not found." }, 404);
  }

  const priceText = purchaseRow.price_total !== null ? ` (${formatMoney(purchaseRow.price_total)})` : "";

  await c.env.DB.batch([
    await auditStatement(c.env.DB, session, {
      action: "delete_purchase",
      entityType: "purchase",
      entityId: purchaseRow.id,
      summary: `Deleted purchase of ${purchaseRow.item_name}${priceText}`,
      details: {
        id: purchaseRow.id,
        itemId: purchaseRow.item_id,
        itemName: purchaseRow.item_name,
        purchasedAt: purchaseRow.purchased_at,
        qty: purchaseRow.qty,
        unit: purchaseRow.unit,
        priceTotal: purchaseRow.price_total,
        boughtBy: purchaseRow.bought_by,
        note: purchaseRow.note,
      },
    }),
    c.env.DB.prepare("DELETE FROM purchase WHERE id = ? AND household_id = ?").bind(id, session.householdId),
  ]);

  await relearnInterval(c.env.DB, purchaseRow.item_id, session.householdId);

  return c.json({ ok: true });
});

export default purchases;
