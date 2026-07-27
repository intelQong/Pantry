import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";

const json = (path: string, body: unknown, cookie?: string, method = "POST") =>
  SELF.fetch(`https://pantry.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });

const cookieFrom = (res: Response): string => {
  const header = res.headers.get("Set-Cookie") ?? "";
  return header.split(";")[0] ?? "";
};

let memberCookie: string;
let itemId: string; // "Milk"

beforeAll(async () => {
  await json("/api/setup", {
    householdName: "Our Kitchen",
    passcode: "rice2026",
    memberNames: ["Mahmudul", "Wife"],
  });

  const login = await json("/api/login", { passcode: "rice2026" });
  const loginCookie = cookieFrom(login);
  const session = await get("/api/session", loginCookie);
  const { members } = await session.json<{ members: Array<{ id: string }> }>();
  const profile = await json("/api/profile", { memberId: members[0]!.id }, loginCookie);
  memberCookie = cookieFrom(profile);

  const item = await json("/api/items", { name: "Milk" }, memberCookie);
  itemId = (await item.json<{ id: string }>()).id;
});

describe("shop list", () => {
  it("requires a session to read the list", async () => {
    expect((await get("/api/list")).status).toBe(401);
  });

  it("adds a known item to the list", async () => {
    const res = await json("/api/list", { itemId, note: "2%" }, memberCookie);
    expect(res.status).toBe(201);
    const entry = await res.json<Record<string, unknown>>();
    expect(entry).toMatchObject({ itemId, displayName: "Milk", note: "2%", status: "pending" });
  });

  it("re-adding an already-pending item updates it instead of erroring", async () => {
    const before = await get("/api/list", memberCookie);
    const beforeCount = (await before.json<unknown[]>()).length;

    const res = await json("/api/list", { itemId, qty: 3, note: "whole milk this time" }, memberCookie);
    expect(res.status).toBe(200); // updated, not created
    const entry = await res.json<Record<string, unknown>>();
    expect(entry).toMatchObject({ itemId, qty: 3, note: "whole milk this time" });

    const after = await get("/api/list", memberCookie);
    expect((await after.json<unknown[]>()).length).toBe(beforeCount);
  });

  it("rejects an entry with both itemId and customName", async () => {
    const res = await json("/api/list", { itemId, customName: "Also milk" }, memberCookie);
    expect(res.status).toBe(400);
  });

  it("rejects an entry with neither itemId nor customName", async () => {
    const res = await json("/api/list", { note: "what am I even buying" }, memberCookie);
    expect(res.status).toBe(400);
  });

  it("adds a custom_name entry and does not dedupe it against itself", async () => {
    const res = await json("/api/list", { customName: "Birthday candles" }, memberCookie);
    expect(res.status).toBe(201);
    const entry = await res.json<Record<string, unknown>>();
    expect(entry).toMatchObject({ itemId: null, customName: "Birthday candles", displayName: "Birthday candles" });
  });

  it("PATCHes qty/note on an entry", async () => {
    const list = await get("/api/list", memberCookie);
    const candles = (await list.json<Array<{ id: string; customName: string | null }>>()).find(
      (e) => e.customName === "Birthday candles",
    )!;

    const res = await json(`/api/list/${candles.id}`, { qty: 4 }, memberCookie, "PATCH");
    expect(res.status).toBe(200);
    expect((await res.json<{ qty: number }>()).qty).toBe(4);
  });

  it("DELETEs an entry outright", async () => {
    const create = await json("/api/list", { customName: "Throwaway" }, memberCookie);
    const created = await create.json<{ id: string }>();

    const del = await json(`/api/list/${created.id}`, {}, memberCookie, "DELETE");
    expect(del.status).toBe(200);

    const row = await env.DB.prepare("SELECT id FROM list_entry WHERE id = ?")
      .bind(created.id)
      .first();
    expect(row).toBeNull();
  });

  it("skips an entry", async () => {
    const create = await json("/api/list", { customName: "Maybe later" }, memberCookie);
    const created = await create.json<{ id: string }>();

    const res = await json(`/api/list/${created.id}/skip`, {}, memberCookie);
    expect(res.status).toBe(200);
    expect((await res.json<{ status: string }>()).status).toBe("skipped");

    const list = await get("/api/list", memberCookie);
    const ids = (await list.json<Array<{ id: string }>>()).map((e) => e.id);
    expect(ids).not.toContain(created.id);
  });
});

describe("buying", () => {
  it("buying a list entry writes a purchase row and updates item.last_purchased_at", async () => {
    const add = await json("/api/list", { itemId, qty: 2 }, memberCookie);
    const entry = await add.json<{ id: string }>();

    const res = await json(`/api/list/${entry.id}/bought`, { priceTotal: 25000 }, memberCookie);
    expect(res.status).toBe(200);
    const { purchaseId } = await res.json<{ purchaseId: string }>();

    const listRow = await env.DB.prepare(
      "SELECT status, resolved_at FROM list_entry WHERE id = ?",
    )
      .bind(entry.id)
      .first<{ status: string; resolved_at: number | null }>();
    expect(listRow?.status).toBe("bought");
    expect(listRow?.resolved_at).not.toBeNull();

    const purchaseRow = await env.DB.prepare(
      "SELECT item_id, qty, price_total, bought_by FROM purchase WHERE id = ?",
    )
      .bind(purchaseId)
      .first<{ item_id: string; qty: number; price_total: number | null; bought_by: string | null }>();
    expect(purchaseRow).toMatchObject({ item_id: itemId, qty: 2, price_total: 25000 });
    expect(purchaseRow?.bought_by).not.toBeNull();

    const itemRow = await env.DB.prepare("SELECT last_purchased_at FROM item WHERE id = ?")
      .bind(itemId)
      .first<{ last_purchased_at: number | null }>();
    expect(itemRow?.last_purchased_at).not.toBeNull();
  });

  it("buying with no price leaves price_total NULL", async () => {
    const add = await json("/api/list", { itemId }, memberCookie);
    const entry = await add.json<{ id: string }>();

    const res = await json(`/api/list/${entry.id}/bought`, {}, memberCookie);
    expect(res.status).toBe(200);
    const { purchaseId } = await res.json<{ purchaseId: string }>();

    const purchaseRow = await env.DB.prepare("SELECT price_total FROM purchase WHERE id = ?")
      .bind(purchaseId)
      .first<{ price_total: number | null }>();
    expect(purchaseRow?.price_total).toBeNull();
  });

  it("rejects a float or negative priceTotal", async () => {
    const add1 = await json("/api/list", { itemId }, memberCookie);
    const entry1 = await add1.json<{ id: string }>();
    expect((await json(`/api/list/${entry1.id}/bought`, { priceTotal: 12.5 }, memberCookie)).status).toBe(400);

    const add2 = await json("/api/list", { itemId }, memberCookie);
    const entry2 = await add2.json<{ id: string }>();
    expect((await json(`/api/list/${entry2.id}/bought`, { priceTotal: -1 }, memberCookie)).status).toBe(400);
  });

  it("buying a custom_name entry resolves it and creates no purchase row", async () => {
    const add = await json("/api/list", { customName: "Napkins" }, memberCookie);
    const entry = await add.json<{ id: string }>();

    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM purchase").first<{ n: number }>();

    const res = await json(`/api/list/${entry.id}/bought`, { priceTotal: 500 }, memberCookie);
    expect(res.status).toBe(200);

    const listRow = await env.DB.prepare("SELECT status FROM list_entry WHERE id = ?")
      .bind(entry.id)
      .first<{ status: string }>();
    expect(listRow?.status).toBe("bought");

    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM purchase").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("404s buying a list entry that doesn't exist", async () => {
    expect((await json("/api/list/nope/bought", {}, memberCookie)).status).toBe(404);
  });
});

describe("cross-household isolation", () => {
  let otherHouseholdId: string;
  let otherEntryId: string;
  let otherItemId: string;

  beforeAll(async () => {
    otherHouseholdId = crypto.randomUUID();
    otherItemId = crypto.randomUUID();
    otherEntryId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO household (id, name, passcode_hash, created_at) VALUES (?,?,?,?)",
      ).bind(otherHouseholdId, "Household B", "pbkdf2$1$AA$AA", now),
      env.DB.prepare(
        "INSERT INTO item (id, household_id, name, created_at) VALUES (?,?,?,?)",
      ).bind(otherItemId, otherHouseholdId, "B's Item", now),
      env.DB.prepare(
        "INSERT INTO list_entry (id, household_id, item_id, added_at, status) VALUES (?,?,?,?,'pending')",
      ).bind(otherEntryId, otherHouseholdId, otherItemId, now),
    ]);
  });

  it("cannot see another household's list entries in GET /api/list", async () => {
    const res = await get("/api/list", memberCookie);
    const ids = (await res.json<Array<{ id: string }>>()).map((e) => e.id);
    expect(ids).not.toContain(otherEntryId);
  });

  it("cannot PATCH, DELETE, skip, or buy another household's list entry", async () => {
    expect((await json(`/api/list/${otherEntryId}`, { qty: 9 }, memberCookie, "PATCH")).status).toBe(404);
    expect((await json(`/api/list/${otherEntryId}/skip`, {}, memberCookie)).status).toBe(404);
    expect((await json(`/api/list/${otherEntryId}/bought`, {}, memberCookie)).status).toBe(404);
    expect((await json(`/api/list/${otherEntryId}`, {}, memberCookie, "DELETE")).status).toBe(404);

    const row = await env.DB.prepare("SELECT status FROM list_entry WHERE id = ?")
      .bind(otherEntryId)
      .first<{ status: string }>();
    expect(row?.status).toBe("pending");
  });

  it("cannot add to another household's list by guessing its itemId", async () => {
    const res = await json("/api/list", { itemId: otherItemId }, memberCookie);
    expect(res.status).toBe(400);
  });
});

describe("buying is idempotent", () => {
  // Regression: buying used to be unguarded, so a double-tap in Shop Mode or a
  // retry over flaky shop wifi wrote two purchase rows. Duplicates silently
  // corrupt the learned restock interval and the spend totals, and nothing
  // downstream can distinguish them from a genuine repeat purchase.
  it("writes only one purchase when the same entry is bought twice", async () => {
    const item = await json("/api/items", { name: "Lentils" }, memberCookie);
    const lentilsId = (await item.json<{ id: string }>()).id;
    const added = await json("/api/list", { itemId: lentilsId }, memberCookie);
    const entryId = (await added.json<{ id: string }>()).id;

    const first = await json(`/api/list/${entryId}/bought`, { priceTotal: 12000 }, memberCookie);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ alreadyResolved: false });

    const second = await json(`/api/list/${entryId}/bought`, { priceTotal: 12000 }, memberCookie);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ alreadyResolved: true, purchaseId: null });

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM purchase WHERE item_id = ?",
    )
      .bind(lentilsId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("does not re-stamp last_purchased_at on a repeat buy", async () => {
    const item = await json("/api/items", { name: "Sugar" }, memberCookie);
    const sugarId = (await item.json<{ id: string }>()).id;
    const added = await json("/api/list", { itemId: sugarId }, memberCookie);
    const entryId = (await added.json<{ id: string }>()).id;

    await json(`/api/list/${entryId}/bought`, {}, memberCookie);
    const after = await env.DB.prepare("SELECT last_purchased_at AS t FROM item WHERE id = ?")
      .bind(sugarId)
      .first<{ t: number }>();

    // Rewind the stamp, then re-buy: a correctly guarded endpoint leaves it alone.
    await env.DB.prepare("UPDATE item SET last_purchased_at = 111 WHERE id = ?").bind(sugarId).run();
    await json(`/api/list/${entryId}/bought`, {}, memberCookie);

    const final = await env.DB.prepare("SELECT last_purchased_at AS t FROM item WHERE id = ?")
      .bind(sugarId)
      .first<{ t: number }>();
    expect(final?.t).toBe(111);
    expect(after?.t).not.toBe(111);
  });

  it("still refuses to buy an entry that was skipped", async () => {
    const item = await json("/api/items", { name: "Cardamom" }, memberCookie);
    const cardamomId = (await item.json<{ id: string }>()).id;
    const added = await json("/api/list", { itemId: cardamomId }, memberCookie);
    const entryId = (await added.json<{ id: string }>()).id;

    await json(`/api/list/${entryId}/skip`, {}, memberCookie);
    const res = await json(`/api/list/${entryId}/bought`, { priceTotal: 500 }, memberCookie);
    expect(await res.json()).toMatchObject({ alreadyResolved: true });

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM purchase WHERE item_id = ?")
      .bind(cardamomId)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});
