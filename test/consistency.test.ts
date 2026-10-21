// Places where two routes used to answer the same question two different ways.
import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import type { AuditLogEntry, InsightsResponse } from "../src/shared/types";

const json = (path: string, body: unknown, cookie?: string, method = "POST") =>
  SELF.fetch(`https://pantry.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, { headers: cookie ? { Cookie: cookie } : {} });

const cookieFrom = (res: Response): string => (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

let sessionCookie: string;
let memberCookie: string;
let otherMemberCookie: string;
let otherMemberId: string;

beforeAll(async () => {
  await json("/api/setup", { householdName: "Same Rules", passcode: "samerules", memberNames: ["A", "B"] });
  sessionCookie = cookieFrom(await json("/api/login", { passcode: "samerules" }));
  const { members } = await (await get("/api/session", sessionCookie)).json<{ members: Array<{ id: string }> }>();
  memberCookie = cookieFrom(await json("/api/profile", { memberId: members[0]!.id }, sessionCookie));
  otherMemberId = members[1]!.id;
  otherMemberCookie = cookieFrom(await json("/api/profile", { memberId: otherMemberId }, sessionCookie));
});

const itemsNamed = async (name: string) =>
  (
    await env.DB.prepare("SELECT id FROM item WHERE LOWER(name) = LOWER(?)").bind(name).all<{ id: string }>()
  ).results;

describe("item names match case-insensitively everywhere", () => {
  it("buying free text 'flour' lands on the existing 'Flour' item, not a twin", async () => {
    const flour = await (await json("/api/items", { name: "Flour" }, memberCookie)).json<{ id: string }>();
    // Inserted directly: POST /list would already fold the free text into the item.
    const entryId = crypto.randomUUID();
    const { id: householdId } = (await env.DB.prepare("SELECT id FROM household").first<{ id: string }>())!;
    await env.DB.prepare(
      "INSERT INTO list_entry (id, household_id, custom_name, added_at, status) VALUES (?,?,?,?,'pending')",
    )
      .bind(entryId, householdId, "flour", 1)
      .run();

    expect((await json(`/api/list/${entryId}/bought`, {}, memberCookie)).status).toBe(200);
    expect(await itemsNamed("flour")).toEqual([{ id: flour.id }]);
  });
});

describe("POST /purchases validates before it writes", () => {
  it("rejects a bad price without leaving a new item behind", async () => {
    const res = await json("/api/purchases", { itemName: "Ghost Item", priceTotal: 12.5 }, memberCookie);
    expect(res.status).toBe(400);
    expect(await itemsNamed("Ghost Item")).toEqual([]);
  });
});

describe("audited deletes need a person to attribute them to", () => {
  it("refuses to delete an item from a session with no profile", async () => {
    const item = await (await json("/api/items", { name: "Unowned" }, memberCookie)).json<{ id: string }>();
    expect((await json(`/api/items/${item.id}`, {}, sessionCookie, "DELETE")).status).toBe(403);
  });

  it("refuses to delete a list entry from a session with no profile", async () => {
    const entry = await (await json("/api/list", { customName: "Candles" }, memberCookie)).json<{ id: string }>();
    expect((await json(`/api/list/${entry.id}`, {}, sessionCookie, "DELETE")).status).toBe(403);
  });

  it("formats the deleted price the way the app does, poisha included", async () => {
    const created = await (
      await json("/api/purchases", { itemName: "Paneer", priceTotal: 1235 }, memberCookie)
    ).json<{ id: string }>();
    await json(`/api/purchases/${created.id}`, {}, memberCookie, "DELETE");
    const logs = await (await get("/api/audit-log", memberCookie)).json<AuditLogEntry[]>();
    expect(logs.find((l) => l.entityId === created.id)?.summary).toBe("Deleted purchase of Paneer (৳12.35)");
  });
});

describe("insights buckets by the member's local day, like History does", () => {
  it("puts a 02:00 Dhaka purchase on that Dhaka date, not the UTC one before it", async () => {
    // 2026-03-14 20:00 UTC is 2026-03-15 02:00 in Asia/Dhaka (UTC+6).
    const at = Date.UTC(2026, 2, 14, 20) / 1000;
    const item = await (await json("/api/items", { name: "Late Milk" }, memberCookie)).json<{ id: string }>();
    const { id: householdId } = (await env.DB.prepare("SELECT id FROM household").first<{ id: string }>())!;
    await env.DB.prepare(
      "INSERT INTO purchase (id, household_id, item_id, purchased_at, qty, unit, price_total) VALUES (?,?,?,?,1,'pcs',100)",
    )
      .bind(crypto.randomUUID(), householdId, item.id, at)
      .run();

    const d = await (await get("/api/insights", memberCookie)).json<InsightsResponse>();
    const keys = d.byDay.map((b) => b.key);
    expect(keys).toContain("2026-03-15");
    expect(keys).not.toContain("2026-03-14");
  });
});

describe("ItemWithStatus keeps its documented contract", () => {
  it("reports daysSince as null for an item never bought, not days since it was created", async () => {
    await json("/api/items", { name: "Never Bought" }, memberCookie);
    const items = await (await get("/api/items", memberCookie)).json<Array<{ name: string; daysSince: number | null }>>();
    expect(items.find((i) => i.name === "Never Bought")?.daysSince).toBeNull();
  });
});

describe("the database agrees that case does not make two items different", () => {
  it("refuses 'tea' when 'Tea' already exists", async () => {
    expect((await json("/api/items", { name: "Tea" }, memberCookie)).status).toBe(201);
    expect((await json("/api/items", { name: "tea" }, memberCookie)).status).toBe(409);
  });

  it("refuses renaming an item onto another's name in a different case", async () => {
    await json("/api/items", { name: "Coffee" }, memberCookie);
    const other = await (await json("/api/items", { name: "Cocoa" }, memberCookie)).json<{ id: string }>();
    expect((await json(`/api/items/${other.id}`, { name: "COFFEE" }, memberCookie, "PATCH")).status).toBe(409);
  });
});

describe("insights buckets stay right across a daylight-saving change", () => {
  it("files a winter purchase under its winter local date, whatever the offset is today", async () => {
    await env.DB.prepare("UPDATE member_settings SET timezone = 'America/New_York' WHERE member_id = ?")
      .bind(otherMemberId)
      .run();
    // 2026-01-15 04:30 UTC is 23:30 on the 14th in New York (EST, UTC-5). Using
    // a summer offset (EDT, UTC-4) for it would land it on the 15th.
    const at = Date.UTC(2026, 0, 15, 4, 30) / 1000;
    const item = await (await json("/api/items", { name: "Winter Soup" }, memberCookie)).json<{ id: string }>();
    const { id: householdId } = (await env.DB.prepare("SELECT id FROM household").first<{ id: string }>())!;
    await env.DB.prepare(
      "INSERT INTO purchase (id, household_id, item_id, purchased_at, qty, unit, price_total) VALUES (?,?,?,?,1,'pcs',100)",
    )
      .bind(crypto.randomUUID(), householdId, item.id, at)
      .run();

    const d = await (await get("/api/insights", otherMemberCookie)).json<InsightsResponse>();
    const keys = d.byDay.map((b) => b.key);
    expect(keys).toContain("2026-01-14");
    expect(keys).not.toContain("2026-01-15");
    expect(d.byWeek.map((b) => b.key)).toContain("2026-01-12");
    expect(d.byMonth.map((b) => b.key)).toContain("2026-01");
  });
});

describe("deleting an item leaves a full record of what went with it", () => {
  it("snapshots the purchases the cascade removes into the audit entry", async () => {
    const bought = await (
      await json("/api/purchases", { itemName: "Cascade Oats", priceTotal: 5000 }, memberCookie)
    ).json<{ id: string; itemId: string }>();
    await json(`/api/items/${bought.itemId}`, {}, memberCookie, "DELETE");

    const logs = await (await get("/api/audit-log", memberCookie)).json<AuditLogEntry[]>();
    const entry = logs.find((l) => l.action === "delete_item" && l.entityId === bought.itemId)!;
    const details = JSON.parse(entry.details!) as { purchases: Array<{ id: string; price_total: number }> };
    expect(details.purchases).toEqual([expect.objectContaining({ id: bought.id, price_total: 5000 })]);
    expect(entry.summary).toBe('Deleted item "Cascade Oats" and its 1 purchase');
  });
});

describe("an item delete racing a purchase on the other phone", () => {
  it("deletes an item with several purchases when nothing moved", async () => {
    const first = await (await json("/api/purchases", { itemName: "Many Buys" }, memberCookie)).json<{ itemId: string }>();
    await json("/api/purchases", { itemId: first.itemId }, memberCookie);
    await json("/api/purchases", { itemId: first.itemId }, memberCookie);
    expect((await json(`/api/items/${first.itemId}`, {}, memberCookie, "DELETE")).status).toBe(200);
  });

  it("writes nothing and asks for a retry if a purchase lands between snapshot and delete", async () => {
    const bought = await (await json("/api/purchases", { itemName: "Raced Item" }, memberCookie)).json<{ itemId: string }>();
    const { id: householdId } = (await env.DB.prepare("SELECT id FROM household").first<{ id: string }>())!;
    const lateId = crypto.randomUUID();

    // The other phone's buy, landing after the route read the purchases but
    // before its batch runs.
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = async (statements) => {
      env.DB.batch = batch;
      await env.DB.prepare(
        "INSERT INTO purchase (id, household_id, item_id, purchased_at, qty, unit) VALUES (?,?,?,?,1,'pcs')",
      )
        .bind(lateId, householdId, bought.itemId, 1)
        .run();
      return batch(statements);
    };

    const res = await json(`/api/items/${bought.itemId}`, {}, memberCookie, "DELETE");
    env.DB.batch = batch;
    expect(res.status).toBe(409);
    expect(await env.DB.prepare("SELECT id FROM purchase WHERE id = ?").bind(lateId).first()).not.toBeNull();
    const logs = await (await get("/api/audit-log", memberCookie)).json<AuditLogEntry[]>();
    expect(logs.some((l) => l.entityId === bought.itemId)).toBe(false);

    // A plain retry then goes through, and records the late purchase too.
    expect((await json(`/api/items/${bought.itemId}`, {}, memberCookie, "DELETE")).status).toBe(200);
  });
});
