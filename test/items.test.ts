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

/** Session cookie with a member chosen -- can write attribution fields. */
let memberCookie: string;
/** Logged in, but no member picked yet -- can read, cannot write attribution. */
let sessionOnlyCookie: string;
let categoryId: string;

beforeAll(async () => {
  await json("/api/setup", {
    householdName: "Our Kitchen",
    passcode: "rice2026",
    memberNames: ["Mahmudul", "Wife"],
  });

  const login = await json("/api/login", { passcode: "rice2026" });
  sessionOnlyCookie = cookieFrom(login);

  const session = await get("/api/session", sessionOnlyCookie);
  const { members } = await session.json<{ members: Array<{ id: string }> }>();

  const profile = await json("/api/profile", { memberId: members[0]!.id }, sessionOnlyCookie);
  memberCookie = cookieFrom(profile);

  const categories = await get("/api/categories", memberCookie);
  const cats = await categories.json<Array<{ id: string; name: string }>>();
  categoryId = cats[0]!.id;
});

describe("items", () => {
  it("requires a session to list items", async () => {
    const res = await get("/api/items");
    expect(res.status).toBe(401);
  });

  it("requires a member (not just a session) to create an item", async () => {
    const res = await json("/api/items", { name: "Eggs" }, sessionOnlyCookie);
    expect(res.status).toBe(403);
  });

  it("rejects an item with no name", async () => {
    const res = await json("/api/items", {}, memberCookie);
    expect(res.status).toBe(400);
  });

  it("creates an item with schema defaults applied", async () => {
    const res = await json("/api/items", { name: "Milk", categoryId }, memberCookie);
    expect(res.status).toBe(201);
    const item = await res.json<Record<string, unknown>>();
    expect(item).toMatchObject({
      name: "Milk",
      categoryId,
      unit: "pcs",
      defaultQty: 1,
      isStaple: true,
      restockIntervalDays: 7,
      intervalLocked: false,
      archived: false,
      lastPurchasedAt: null,
    });
  });

  it("rejects a category that isn't in this household", async () => {
    const res = await json("/api/items", { name: "Bread", categoryId: "made-up" }, memberCookie);
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate active item name", async () => {
    await json("/api/items", { name: "Butter" }, memberCookie);
    const res = await json("/api/items", { name: "Butter" }, memberCookie);
    expect(res.status).toBe(409);
  });

  it("lists all non-archived items for the household", async () => {
    const res = await get("/api/items", memberCookie);
    const list = await res.json<Array<{ name: string }>>();
    expect(list.map((i) => i.name)).toEqual(expect.arrayContaining(["Milk", "Butter"]));
  });

  it("updates fields with PATCH", async () => {
    const create = await json("/api/items", { name: "Rice" }, memberCookie);
    const created = await create.json<{ id: string }>();

    const res = await json(
      `/api/items/${created.id}`,
      { unit: "kg", defaultQty: 5, notes: "5kg bag", isStaple: false },
      sessionOnlyCookie,
      "PATCH",
    );
    expect(res.status).toBe(200);
    const updated = await res.json<Record<string, unknown>>();
    expect(updated).toMatchObject({ unit: "kg", defaultQty: 5, notes: "5kg bag", isStaple: false });
  });

  it("soft-deletes: archived items disappear from GET but aren't destroyed", async () => {
    const create = await json("/api/items", { name: "Onions" }, memberCookie);
    const created = await create.json<{ id: string }>();

    const del = await json(`/api/items/${created.id}`, {}, memberCookie, "DELETE");
    expect(del.status).toBe(200);

    const list = await get("/api/items", memberCookie);
    const names = (await list.json<Array<{ name: string }>>()).map((i) => i.name);
    expect(names).not.toContain("Onions");

    const row = await env.DB.prepare("SELECT archived FROM item WHERE id = ?")
      .bind(created.id)
      .first<{ archived: number }>();
    expect(row?.archived).toBe(1);
  });

  it("404s patching or deleting an item that doesn't exist", async () => {
    expect((await json("/api/items/nope", { name: "x" }, memberCookie, "PATCH")).status).toBe(404);
    expect((await json("/api/items/nope", {}, memberCookie, "DELETE")).status).toBe(404);
  });
});

describe("purchase history", () => {
  it("POST /api/purchases records a purchase directly and stamps the item", async () => {
    const create = await json("/api/items", { name: "Yogurt" }, memberCookie);
    const item = await create.json<{ id: string }>();

    const res = await json(
      "/api/purchases",
      { itemId: item.id, qty: 2, priceTotal: 15000, note: "family pack" },
      memberCookie,
    );
    expect(res.status).toBe(201);
    const purchase = await res.json<Record<string, unknown>>();
    expect(purchase).toMatchObject({ itemId: item.id, qty: 2, priceTotal: 15000 });

    const row = await env.DB.prepare("SELECT last_purchased_at FROM item WHERE id = ?")
      .bind(item.id)
      .first<{ last_purchased_at: number | null }>();
    expect(row?.last_purchased_at).not.toBeNull();

    const history = await get(`/api/items/${item.id}/purchases`, memberCookie);
    const purchases = await history.json<Array<{ itemId: string }>>();
    expect(purchases).toHaveLength(1);
    expect(purchases[0]!.itemId).toBe(item.id);
  });

  it("rejects a non-integer or negative priceTotal", async () => {
    const create = await json("/api/items", { name: "Cheese" }, memberCookie);
    const item = await create.json<{ id: string }>();

    expect(
      (await json("/api/purchases", { itemId: item.id, priceTotal: 19.99 }, memberCookie)).status,
    ).toBe(400);
    expect(
      (await json("/api/purchases", { itemId: item.id, priceTotal: -5 }, memberCookie)).status,
    ).toBe(400);
  });
});

describe("cross-household isolation", () => {
  let otherItemId: string;

  beforeAll(async () => {
    // Build a second household directly through D1, bypassing the API --
    // exactly the setup an attacker (or a buggy client) could never legitimately
    // reach through household A's session.
    const householdId = crypto.randomUUID();
    const categoryIdB = crypto.randomUUID();
    otherItemId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO household (id, name, passcode_hash, created_at) VALUES (?,?,?,?)",
      ).bind(householdId, "Household B", "pbkdf2$1$AA$AA", now),
      env.DB.prepare(
        "INSERT INTO category (id, household_id, name, sort_order) VALUES (?,?,?,?)",
      ).bind(categoryIdB, householdId, "B Category", 0),
      env.DB.prepare(
        "INSERT INTO item (id, household_id, name, category_id, created_at) VALUES (?,?,?,?,?)",
      ).bind(otherItemId, householdId, "Secret Item", categoryIdB, now),
    ]);
  });

  it("cannot see another household's items in GET /api/items", async () => {
    const res = await get("/api/items", memberCookie);
    const names = (await res.json<Array<{ name: string }>>()).map((i) => i.name);
    expect(names).not.toContain("Secret Item");
  });

  it("cannot PATCH another household's item", async () => {
    const res = await json(`/api/items/${otherItemId}`, { name: "Hacked" }, memberCookie, "PATCH");
    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT name FROM item WHERE id = ?")
      .bind(otherItemId)
      .first<{ name: string }>();
    expect(row?.name).toBe("Secret Item");
  });

  it("cannot DELETE another household's item", async () => {
    const res = await json(`/api/items/${otherItemId}`, {}, memberCookie, "DELETE");
    expect(res.status).toBe(404);

    const row = await env.DB.prepare("SELECT archived FROM item WHERE id = ?")
      .bind(otherItemId)
      .first<{ archived: number }>();
    expect(row?.archived).toBe(0);
  });

  it("cannot read another household's purchase history", async () => {
    const res = await get(`/api/items/${otherItemId}/purchases`, memberCookie);
    expect(res.status).toBe(404);
  });
});
