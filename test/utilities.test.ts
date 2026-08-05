import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";

const json = (path: string, body: unknown, cookie?: string, method = "POST") =>
  SELF.fetch(`https://pantry.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, { headers: cookie ? { Cookie: cookie } : {} });

const cookieFrom = (res: Response): string => (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

let memberCookie: string;

beforeAll(async () => {
  await json("/api/setup", {
    householdName: "Our Kitchen",
    passcode: "rice2026",
    memberNames: ["Mahmudul", "Wife"],
  });
  const login = await json("/api/login", { passcode: "rice2026" });
  const sessionCookie = cookieFrom(login);
  const session = await get("/api/session", sessionCookie);
  const { members } = await session.json<{ members: Array<{ id: string }> }>();
  const profile = await json("/api/profile", { memberId: members[0]!.id }, sessionCookie);
  memberCookie = cookieFrom(profile);
});

describe("utilities seeding", () => {
  it("gives the household a Utilities category", async () => {
    const res = await get("/api/categories", memberCookie);
    const cats = await res.json<Array<{ id: string; name: string }>>();
    expect(cats.map((c) => c.name)).toContain("Utilities");
  });

  it("seeds gas, electricity and wifi into it", async () => {
    const catRes = await get("/api/categories", memberCookie);
    const cats = await catRes.json<Array<{ id: string; name: string }>>();
    const utilities = cats.find((c) => c.name === "Utilities")!;

    const res = await get("/api/items", memberCookie);
    const items = await res.json<Array<{ name: string; categoryId: string | null; unit: string }>>();
    const seeded = items.filter((i) => i.categoryId === utilities.id);

    expect(seeded.map((i) => i.name).sort()).toEqual([
      "Electricity Recharge",
      "Gas Cylinder",
      "Wifi Bill",
    ]);
    expect(seeded.find((i) => i.name === "Gas Cylinder")!.unit).toBe("cylinder");
  });

  it("locks the wifi interval so a late payment does not stretch the cycle", async () => {
    const res = await get("/api/items", memberCookie);
    const items = await res.json<Array<{ id: string; name: string; restockIntervalDays: number; intervalLocked: boolean }>>();
    const wifi = items.find((i) => i.name === "Wifi Bill")!;

    expect(wifi.restockIntervalDays).toBe(30);
    expect(wifi.intervalLocked).toBe(true);
  });
});

describe("utilities stay out of the grocery screens", () => {
  it("flags them so no screen has to guess from category names", async () => {
    const res = await get("/api/items", memberCookie);
    const items = await res.json<Array<{ name: string; isUtility: boolean }>>();

    expect(items.find((i) => i.name === "Wifi Bill")!.isUtility).toBe(true);
    // Anything uncategorised must come back false, not null: the correlated
    // subquery returns NULL when category_id is null, and a null here would
    // sail through a `!i.isUtility` filter but fail an `=== false` check.
    const created = await json(
      "/api/items",
      { name: "Loose Tea", categoryId: null },
      memberCookie,
    );
    const tea = await created.json<{ isUtility: boolean }>();
    expect(tea.isUtility).toBe(false);
  });

  it("keeps them off Today, which is the shop-trip screen", async () => {
    const res = await get("/api/today", memberCookie);
    const today = await res.json<Array<{ name: string }>>();
    const names = today.map((i) => i.name);

    expect(names).not.toContain("Wifi Bill");
    expect(names).not.toContain("Gas Cylinder");
    expect(names).not.toContain("Electricity Recharge");
  });
});

describe("shopping history", () => {
  it("lists purchases newest first, named, and without the utility bills", async () => {
    const itemsRes = await get("/api/items", memberCookie);
    const items = await itemsRes.json<Array<{ id: string; name: string }>>();
    const gas = items.find((i) => i.name === "Gas Cylinder")!;

    const rice = await (
      await json("/api/items", { name: "Rice", unit: "kg" }, memberCookie)
    ).json<{ id: string }>();

    const day = 86400;
    const now = Math.floor(Date.now() / 1000);
    await json("/api/purchases", { itemId: rice.id, qty: 5, priceTotal: 25000, purchasedAt: now - 3 * day }, memberCookie);
    await json("/api/purchases", { itemId: rice.id, qty: 5, priceTotal: 26000, purchasedAt: now - day }, memberCookie);
    await json("/api/purchases", { itemId: gas.id, priceTotal: 150000 }, memberCookie);

    const res = await get("/api/purchases", memberCookie);
    expect(res.status).toBe(200);
    const history = await res.json<Array<{ itemName: string; purchasedAt: number; priceTotal: number | null }>>();

    // The gas refill is a bill, not a shop: it belongs to the Bills log only.
    expect(history.map((p) => p.itemName)).not.toContain("Gas Cylinder");

    const riceBuys = history.filter((p) => p.itemName === "Rice");
    expect(riceBuys).toHaveLength(2);
    expect(riceBuys[0]!.priceTotal).toBe(26000); // newest first
    expect(riceBuys[0]!.purchasedAt).toBeGreaterThan(riceBuys[1]!.purchasedAt);
  });

  it("requires a session", async () => {
    expect((await get("/api/purchases")).status).toBe(401);
  });
});
