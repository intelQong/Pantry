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

interface MergeTarget {
  id: string;
  qty: number | null;
  note: string | null;
}

/**
 * The pending row this add belongs to, if the list already has one.
 *
 * Known items match on item_id, which idx_list_unique_pending_item keeps
 * unique. Free text matches on the *displayed* name, case-insensitively:
 * "rice" and "Rice" are the same shop trip, and matching a known item's name
 * too means typing out something already on the list merges into it rather
 * than sitting beside it as an untracked twin.
 */
async function findPendingDuplicate(
  db: D1Database,
  householdId: string,
  itemId: string | null,
  customName: string | null,
): Promise<MergeTarget | null> {
  if (itemId) {
    return db
      .prepare(
        "SELECT id, qty, note FROM list_entry WHERE household_id = ? AND item_id = ? AND status = 'pending'",
      )
      .bind(householdId, itemId)
      .first<MergeTarget>();
  }

  return db
    .prepare(
      `SELECT le.id, le.qty, le.note
         FROM list_entry le
         LEFT JOIN item i ON i.id = le.item_id
        WHERE le.household_id = ? AND le.status = 'pending'
          AND LOWER(COALESCE(i.name, le.custom_name)) = LOWER(?)`,
    )
    .bind(householdId, customName)
    .first<MergeTarget>();
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

  const customName = itemId ? null : body.customName!.trim();

  /**
   * Folds this add into the row that is already there.
   *
   * An add with no quantity of its own means "one more of these", so it adds
   * one rather than leaving the count alone -- otherwise the second phone's add
   * would vanish without trace. A blank qty counts as one, matching what an
   * empty quantity box means on the list itself. Replays cannot inflate this:
   * a retried add is caught by its clientId long before it reaches here.
   */
  const mergeInto = async (target: MergeTarget) => {
    await c.env.DB.prepare("UPDATE list_entry SET qty = ?, note = ? WHERE id = ?")
      .bind(
        body.qty !== undefined ? body.qty : (target.qty ?? 1) + 1,
        body.note !== undefined ? body.note : target.note,
        target.id,
      )
      .run();
    const row = await fetchListEntry(c.env.DB, target.id, session.householdId);
    return c.json(toListEntry(row!));
  };

  const existing = await findPendingDuplicate(
    c.env.DB,
    session.householdId,
    itemId,
    customName,
  );
  if (existing) return mergeInto(existing);

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
        customName,
        body.qty ?? null,
        body.note ?? null,
        session.memberId,
        now,
        clientId,
      )
      .run();
  } catch (err) {
    // The lookup above is check-then-act, so two adds arriving together can
    // both miss it and race to insert. A unique index is what actually decides
    // that race -- idx_list_client_id for a retry of one queued add,
    // idx_list_unique_pending_item and idx_list_unique_pending_name for two
    // separate adds of the same thing. Whichever loses folds into the winner's
    // row, which is the same answer it would have got without the race.
    const raced = clientId
      ? await fetchListEntryByClientId(c.env.DB, clientId, session.householdId)
      : null;
    if (raced) return c.json(toListEntry(raced));

    const winner = await findPendingDuplicate(
      c.env.DB,
      session.householdId,
      itemId,
      customName,
    );
    if (!winner) throw err;
    return mergeInto(winner);
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
