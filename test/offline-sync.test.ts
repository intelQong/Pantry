// What the server has to guarantee for an offline shop to sync correctly.
//
// Two properties, both of which the API lacked before offline support:
//
//   1. A purchase records when the shop happened, not when the wifi came back.
//      Everything the restock engine knows is derived from purchase.purchased_at
//      and item.last_purchased_at, so syncing a Saturday shop on Sunday used to
//      move every learned interval and due date by a day.
//
//   2. A queued add can be retried. Buying was already replay-safe; adding was
//      not, so a lost response duplicated the row.

import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";

const json = (path: string, body: unknown, cookie?: string, method = "POST") =>
  SELF.fetch(`https://pantry.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, { headers: cookie ? { Cookie: cookie } : {} });

const cookieFrom = (res: Response): string => (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

let memberCookie: string;

/** Creates an item and puts it on the list, returning both ids. */
async function stage(name: string) {
  const item = await json("/api/items", { name }, memberCookie);
  const itemId = (await item.json<{ id: string }>()).id;
  const added = await json("/api/list", { itemId }, memberCookie);
  const entryId = (await added.json<{ id: string }>()).id;
  return { itemId, entryId };
}

beforeAll(async () => {
  await json("/api/setup", {
    householdName: "Our Kitchen",
    passcode: "rice2026",
    memberNames: ["Mahmudul", "Partner"],
  });

  const loginCookie = cookieFrom(await json("/api/login", { passcode: "rice2026" }));
  const session = await get("/api/session", loginCookie);
  const { members } = await session.json<{ members: Array<{ id: string }> }>();
  memberCookie = cookieFrom(await json("/api/profile", { memberId: members[0]!.id }, loginCookie));
});

describe("backdated purchases", () => {
  it("records the purchase at the time it was made, not the time it synced", async () => {
    const { itemId, entryId } = await stage("Backdated Rice");
    const shoppedAt = now() - 2 * DAY;

    const res = await json(
      `/api/list/${entryId}/bought`,
      { priceTotal: 8000, purchasedAt: shoppedAt },
      memberCookie,
    );
    expect(res.status).toBe(200);
    const { purchaseId } = await res.json<{ purchaseId: string }>();

    const row = await env.DB.prepare("SELECT purchased_at FROM purchase WHERE id = ?")
      .bind(purchaseId)
      .first<{ purchased_at: number }>();
    expect(row?.purchased_at).toBe(shoppedAt);

    const item = await env.DB.prepare("SELECT last_purchased_at AS t FROM item WHERE id = ?")
      .bind(itemId)
      .first<{ t: number }>();
    expect(item?.t).toBe(shoppedAt);
  });

  it("defaults to now when the client sends no timestamp", async () => {
    const { entryId } = await stage("Undated Salt");
    const before = now();

    const res = await json(`/api/list/${entryId}/bought`, {}, memberCookie);
    const { purchaseId } = await res.json<{ purchaseId: string }>();

    const row = await env.DB.prepare("SELECT purchased_at FROM purchase WHERE id = ?")
      .bind(purchaseId)
      .first<{ purchased_at: number }>();
    expect(row!.purchased_at).toBeGreaterThanOrEqual(before);
    expect(row!.purchased_at).toBeLessThanOrEqual(now());
  });

  it("clamps a future timestamp to now, so a fast phone clock can still sync", async () => {
    const { entryId } = await stage("Future Flour");

    const res = await json(
      `/api/list/${entryId}/bought`,
      { purchasedAt: now() + 400 * DAY },
      memberCookie,
    );
    const { purchaseId } = await res.json<{ purchaseId: string }>();

    const row = await env.DB.prepare("SELECT purchased_at FROM purchase WHERE id = ?")
      .bind(purchaseId)
      .first<{ purchased_at: number }>();
    expect(row!.purchased_at).toBeLessThanOrEqual(now());
  });

  it("floors a timestamp older than the backdate window", async () => {
    const { entryId } = await stage("Ancient Oats");
    const floor = now() - 30 * DAY;

    const res = await json(`/api/list/${entryId}/bought`, { purchasedAt: 1000 }, memberCookie);
    const { purchaseId } = await res.json<{ purchaseId: string }>();

    const row = await env.DB.prepare("SELECT purchased_at FROM purchase WHERE id = ?")
      .bind(purchaseId)
      .first<{ purchased_at: number }>();
    expect(row!.purchased_at).toBeGreaterThanOrEqual(floor - 5);
  });

  it("rejects a non-integer timestamp", async () => {
    const { entryId } = await stage("Floaty Tea");
    const res = await json(`/api/list/${entryId}/bought`, { purchasedAt: 1.5 }, memberCookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_purchased_at" });
  });

  // The regression this whole mechanism exists to prevent: two phones sync out
  // of order, and the older shop lands last. last_purchased_at drives when the
  // item next comes due, so letting it move backwards makes the app nag about
  // something bought this morning.
  it("never winds last_purchased_at backwards when an older buy syncs late", async () => {
    const { itemId, entryId } = await stage("Out Of Order Ghee");
    const recent = now() - 1 * DAY;

    await json(`/api/list/${entryId}/bought`, { purchasedAt: recent }, memberCookie);

    const second = await json("/api/list", { itemId }, memberCookie);
    const secondEntry = (await second.json<{ id: string }>()).id;
    await json(`/api/list/${secondEntry}/bought`, { purchasedAt: now() - 20 * DAY }, memberCookie);

    const item = await env.DB.prepare("SELECT last_purchased_at AS t FROM item WHERE id = ?")
      .bind(itemId)
      .first<{ t: number }>();
    expect(item?.t).toBe(recent);
  });

  it("feeds the backdated timestamps into the learned interval", async () => {
    const item = await json("/api/items", { name: "Learned Lentils" }, memberCookie);
    const itemId = (await item.json<{ id: string }>()).id;

    // Four buys three days apart, all synced now but stamped in the past. The
    // engine should learn ~3 days, which it can only do if it reads the client
    // timestamps rather than the sync time.
    for (const daysAgo of [12, 9, 6, 3]) {
      await json(
        "/api/purchases",
        { itemId, purchasedAt: now() - daysAgo * DAY },
        memberCookie,
      );
    }

    const row = await env.DB.prepare("SELECT restock_interval_days AS d FROM item WHERE id = ?")
      .bind(itemId)
      .first<{ d: number }>();
    expect(row?.d).toBe(3);
  });

  it("backdates a purchase made through POST /purchases", async () => {
    const item = await json("/api/items", { name: "Tracked Later" }, memberCookie);
    const itemId = (await item.json<{ id: string }>()).id;
    const shoppedAt = now() - 5 * DAY;

    const res = await json("/api/purchases", { itemId, purchasedAt: shoppedAt }, memberCookie);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ purchasedAt: shoppedAt });
  });
});

describe("replayable adds", () => {
  it("returns the same entry when a queued add is retried", async () => {
    const clientId = crypto.randomUUID();

    const first = await json("/api/list", { customName: "Birthday candles", clientId }, memberCookie);
    expect(first.status).toBe(201);
    const created = await first.json<{ id: string; clientId: string }>();
    expect(created.clientId).toBe(clientId);

    const retry = await json("/api/list", { customName: "Birthday candles", clientId }, memberCookie);
    expect(retry.status).toBe(200); // matched, not created
    expect((await retry.json<{ id: string }>()).id).toBe(created.id);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM list_entry WHERE custom_name = ?",
    )
      .bind("Birthday candles")
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("merges free text added twice without a clientId, ignoring case", async () => {
    // Two people adding the same thing want one row with a bigger number on it,
    // not two rows. The clientId dedupe still matters on top of this: it also
    // covers a retry that would otherwise *bump* the qty a second time.
    await json("/api/list", { customName: "Paper towels" }, memberCookie);
    await json("/api/list", { customName: "paper TOWELS" }, memberCookie);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM list_entry WHERE LOWER(custom_name) = ?",
    )
      .bind("paper towels")
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("matches a retry even after the entry was already bought", async () => {
    const clientId = crypto.randomUUID();
    const first = await json("/api/list", { customName: "Cling film", clientId }, memberCookie);
    const entryId = (await first.json<{ id: string }>()).id;

    await json(`/api/list/${entryId}/bought`, {}, memberCookie);

    // The queue retries the add after the buy already synced. It must not
    // resurrect the item onto the list.
    const retry = await json("/api/list", { customName: "Cling film", clientId }, memberCookie);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: entryId, status: "bought" });

    const list = await get("/api/list", memberCookie);
    const names = (await list.json<Array<{ displayName: string }>>()).map((e) => e.displayName);
    expect(names).not.toContain("Cling film");
  });

  it("scopes client ids to the household", async () => {
    const clientId = crypto.randomUUID();
    await json("/api/list", { customName: "Shared id", clientId }, memberCookie);

    const otherHouseholdId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO household (id, name, passcode_hash, created_at) VALUES (?,?,?,?)",
    )
      .bind(otherHouseholdId, "Household B", "pbkdf2$1$AA$AA", now())
      .run();
    await env.DB.prepare(
      `INSERT INTO list_entry (id, household_id, custom_name, added_at, status, client_id)
       VALUES (?,?,?,?,'pending',?)`,
    )
      .bind(crypto.randomUUID(), otherHouseholdId, "Their thing", now(), clientId)
      .run();

    // Same client id, two households, no collision and no leak.
    const mine = await get("/api/list", memberCookie);
    const names = (await mine.json<Array<{ displayName: string }>>()).map((e) => e.displayName);
    expect(names).toContain("Shared id");
    expect(names).not.toContain("Their thing");
  });
});
