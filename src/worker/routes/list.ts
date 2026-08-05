import { Hono } from "hono";
import type { AppEnv } from "../env";
import { nowSeconds } from "../env";
import { requireSession, requireMember } from "../middleware";
import type { ListEntry } from "../../shared/types";

const list = new Hono<AppEnv>();

interface ListEntryRow {
  id: string;
  item_id: string | null;
  custom_name: string | null;
  display_name: string;
  category_id: string | null;
  qty: number | null;
  note: string | null;
  added_by: string | null;
  added_at: number;
  status: "pending" | "bought" | "skipped";
  client_id: string | null;
}

function toListEntry(row: ListEntryRow): ListEntry {
  return {
    id: row.id,
    itemId: row.item_id,
    customName: row.custom_name,
    displayName: row.display_name,
    categoryId: row.category_id,
    qty: row.qty,
    note: row.note,
    addedBy: row.added_by,
    addedAt: row.added_at,
    status: row.status,
    clientId: row.client_id,
  };
}

/** The column list every entry read shares, so they all map cleanly through toListEntry. */
const ENTRY_COLUMNS = `le.id, le.item_id, le.custom_name,
            COALESCE(i.name, le.custom_name) AS display_name,
            i.category_id AS category_id,
            le.qty, le.note, le.added_by, le.added_at, le.status, le.client_id`;

/** Pending entries in aisle order: category sort_order, then when they were added. */
list.get("/list", requireSession, async (c) => {
  const session = c.get("session");
  const rows = await c.env.DB.prepare(
    `SELECT ${ENTRY_COLUMNS}
       FROM list_entry le
       LEFT JOIN item i ON i.id = le.item_id
       LEFT JOIN category c ON c.id = i.category_id
      WHERE le.household_id = ? AND le.status = 'pending'
      ORDER BY COALESCE(c.sort_order, 999999), le.added_at`,
  )
    .bind(session.householdId)
    .all<ListEntryRow>();

  return c.json(rows.results.map(toListEntry));
});

async function fetchListEntry(db: D1Database, id: string, householdId: string) {
  return db
    .prepare(
      `SELECT ${ENTRY_COLUMNS}
         FROM list_entry le
         LEFT JOIN item i ON i.id = le.item_id
        WHERE le.id = ? AND le.household_id = ?`,
    )
    .bind(id, householdId)
    .first<ListEntryRow>();
}

/** The row a previous attempt at this same queued add already created, if any. */
async function fetchListEntryByClientId(db: D1Database, clientId: string, householdId: string) {
  return db
    .prepare(
      `SELECT ${ENTRY_COLUMNS}
         FROM list_entry le
         LEFT JOIN item i ON i.id = le.item_id
        WHERE le.client_id = ? AND le.household_id = ?`,
    )
    .bind(clientId, householdId)
    .first<ListEntryRow>();
}

list.post("/list", requireMember, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{
    itemId?: string;
    customName?: string;
    qty?: number | null;
    note?: string | null;
    clientId?: string;
  }>();

  // A client-generated id makes this add replayable. An offline queue has to
  // retry anything whose response it never saw, and without this a lost
  // response would put "birthday candles" on the list twice -- free text has no
  // unique name index to fall back on the way a known item does.
  const clientId = body.clientId?.trim() || null;
  if (clientId) {
    const seen = await fetchListEntryByClientId(c.env.DB, clientId, session.householdId);
    if (seen) return c.json(toListEntry(seen));
  }

  const hasItemId = !!body.itemId;
  const hasCustomName = !!body.customName?.trim();
  // The schema's CHECK enforces exactly one of these; validate up front so we
  // return a clean 400 instead of a raw constraint error.
  if (hasItemId === hasCustomName) {
    return c.json(
      { error: "invalid_entry", message: "Provide exactly one of itemId or customName." },
      400,
    );
  }

  let itemId: string | null = null;
  if (body.itemId) {
    const item = await c.env.DB.prepare(
      "SELECT id FROM item WHERE id = ? AND household_id = ?",
    )
      .bind(body.itemId, session.householdId)
      .first();
    if (!item) {
      return c.json({ error: "unknown_item", message: "That item doesn't exist." }, 400);
    }
    itemId = body.itemId;
  }

  const now = nowSeconds();

  // Nothing goes on the pending list twice. Known items are unique by index
  // (idx_list_unique_pending_item); free text has no index to lean on, so it is
  // matched on the displayed name, case-insensitively -- "rice" and "Rice" are
  // the same shop trip, and it matches a known item's name too so typing what
  // is already there by hand merges rather than duplicates. Either way the add
  // bumps the existing row's qty/note instead of erroring or duplicating.
  const existing = itemId
    ? await c.env.DB.prepare(
        "SELECT id, qty, note FROM list_entry WHERE household_id = ? AND item_id = ? AND status = 'pending'",
      )
        .bind(session.householdId, itemId)
        .first<{ id: string; qty: number | null; note: string | null }>()
    : await c.env.DB.prepare(
        `SELECT le.id, le.qty, le.note
           FROM list_entry le
           LEFT JOIN item i ON i.id = le.item_id
          WHERE le.household_id = ? AND le.status = 'pending'
            AND LOWER(COALESCE(i.name, le.custom_name)) = LOWER(?)`,
      )
        .bind(session.householdId, body.customName!.trim())
        .first<{ id: string; qty: number | null; note: string | null }>();

  if (existing) {
    await c.env.DB.prepare("UPDATE list_entry SET qty = ?, note = ? WHERE id = ?")
      .bind(
        body.qty !== undefined ? body.qty : existing.qty,
        body.note !== undefined ? body.note : existing.note,
        existing.id,
      )
      .run();
    const row = await fetchListEntry(c.env.DB, existing.id, session.householdId);
    return c.json(toListEntry(row!));
  }

  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO list_entry (id, household_id, item_id, custom_name, qty, note, added_by, added_at, status, client_id)
       VALUES (?,?,?,?,?,?,?,?,'pending',?)`,
    )
      .bind(
        id,
        session.householdId,
        itemId,
        itemId ? null : body.customName!.trim(),
        body.qty ?? null,
        body.note ?? null,
        session.memberId,
        now,
        clientId,
      )
      .run();
  } catch (err) {
    // Two retries of the same queued add can both miss the lookup above and
    // race to insert; the unique index is what actually decides it. Whichever
    // loses returns the row the winner wrote, same as if it had never raced.
    if (!clientId) throw err;
    const raced = await fetchListEntryByClientId(c.env.DB, clientId, session.householdId);
    if (!raced) throw err;
    return c.json(toListEntry(raced));
  }

  const row = await fetchListEntry(c.env.DB, id, session.householdId);
  return c.json(toListEntry(row!), 201);
});

list.patch("/list/:id", requireSession, async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const existing = await fetchListEntry(c.env.DB, id, session.householdId);
  if (!existing) {
    return c.json({ error: "not_found", message: "No such list entry." }, 404);
  }

  const body = await c.req.json<{ qty?: number | null; note?: string | null }>();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.qty !== undefined) {
    sets.push("qty = ?");
    values.push(body.qty);
  }
  if (body.note !== undefined) {
    sets.push("note = ?");
    values.push(body.note);
  }

  if (sets.length > 0) {
    // Scoped on the statement itself rather than relying on the existence
    // check above: check-then-act leaves the write correct only for as long as
    // nobody edits the check.
    values.push(id, session.householdId);
    await c.env.DB.prepare(
      `UPDATE list_entry SET ${sets.join(", ")} WHERE id = ? AND household_id = ?`,
    )
      .bind(...values)
      .run();
  }

  const row = await fetchListEntry(c.env.DB, id, session.householdId);
  return c.json(toListEntry(row!));
});

list.delete("/list/:id", requireSession, async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const result = await c.env.DB.prepare("DELETE FROM list_entry WHERE id = ? AND household_id = ?")
    .bind(id, session.householdId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: "not_found", message: "No such list entry." }, 404);
  }
  return c.json({ ok: true });
});

list.post("/list/:id/skip", requireSession, async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const now = nowSeconds();

  const result = await c.env.DB.prepare(
    "UPDATE list_entry SET status = 'skipped', resolved_at = ? WHERE id = ? AND household_id = ? AND status = 'pending'",
  )
    .bind(now, id, session.householdId)
    .run();

  if (result.meta.changes === 0) {
    return c.json(
      { error: "not_found", message: "No such pending list entry." },
      404,
    );
  }

  const row = await fetchListEntry(c.env.DB, id, session.householdId);
  return c.json(toListEntry(row!));
});

export default list;
