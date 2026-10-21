import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import type { InsightsResponse } from "../src/shared/types";

const post = (path: string, body: unknown, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, { headers: cookie ? { Cookie: cookie } : {} });

const cookieFrom = (r: Response) => (r.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

const DAY = 86_400;
let cookie: string;
let householdId: string;
let memberId: string;
let riceId: string;
let saltId: string;

/** Purchases are inserted directly so their timestamps can be placed in the past. */
async function addPurchase(itemId: string, daysAgo: number, qty: number, price: number | null) {
  await env.DB.prepare(
    `INSERT INTO purchase (id, household_id, item_id, purchased_at, qty, unit, price_total, bought_by)
     VALUES (?,?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      householdId,
      itemId,
      Math.floor(Date.now() / 1000) - daysAgo * DAY,
      qty,
      "kg",
      price,
      memberId,
    )
    .run();
}

beforeAll(async () => {
  await post("/api/setup", {
    householdName: "Numbers",
    passcode: "goodenough",
    memberNames: ["Buyer"],
  });
  const login = cookieFrom(await post("/api/login", { passcode: "goodenough" }));
  const session = await (await get("/api/session", login)).json<{
    householdId?: string;
    members: Array<{ id: string }>;
  }>();
  memberId = session.members[0]!.id;
  cookie = cookieFrom(await post("/api/profile", { memberId }, login));

  householdId = (await env.DB.prepare("SELECT id FROM household LIMIT 1").first<{ id: string }>())!.id;

  riceId = (await (await post("/api/items", { name: "Rice", unit: "kg" }, cookie)).json<{ id: string }>()).id;
  saltId = (await (await post("/api/items", { name: "Salt", unit: "kg" }, cookie)).json<{ id: string }>()).id;
});

const fetchInsights = async () =>
  (await get("/api/insights", cookie)).json<InsightsResponse>();

describe("insights with no purchases", () => {
  it("reports no data rather than zeroes that look like real numbers", async () => {
    const d = await fetchInsights();
    expect(d.hasData).toBe(false);
    expect(d.totalPurchases).toBe(0);
    expect(d.topItems).toEqual([]);
    expect(d.byMonth).toEqual([]);
    expect(d.byWeek).toEqual([]);
    expect(d.byDay).toEqual([]);
  });

  it("requires a session", async () => {
    expect((await get("/api/insights")).status).toBe(401);
  });
});

describe("insights with history", () => {
  beforeAll(async () => {
    // Rice: 4 buys over 60 days, 5kg each, ৳300 each.
    for (const d of [60, 40, 20, 2]) await addPurchase(riceId, d, 5, 30000);
    // Salt: 2 buys, one with no price recorded at all.
    await addPurchase(saltId, 50, 1, 5000);
    await addPurchase(saltId, 10, 1, null);
  });

  it("totals spend, and counts how many purchases carried a price", async () => {
    const d = await fetchInsights();
    expect(d.hasData).toBe(true);
    expect(d.totalPurchases).toBe(6);
    expect(d.pricedPurchases).toBe(5); // the priceless salt is excluded
    expect(d.totalSpend).toBe(4 * 30000 + 5000);
  });

  it("windows the last 30 days separately from all time", async () => {
    const d = await fetchInsights();
    // Rice at 20d and 2d, salt at 10d -> 3 purchases, only the rice priced.
    expect(d.purchasesLast30).toBe(3);
    expect(d.spendLast30).toBe(2 * 30000);
  });

  it("derives a monthly consumption rate in the item's own unit", async () => {
    const d = await fetchInsights();
    const rice = d.topItems.find((i) => i.itemId === riceId)!;

    expect(rice.purchases).toBe(4);
    expect(rice.totalQty).toBe(20);
    // 20kg across a 58-day span ≈ 10.3kg per 30 days.
    expect(rice.qtyPerMonth).toBeGreaterThan(9);
    expect(rice.qtyPerMonth).toBeLessThan(12);
    expect(rice.unit).toBe("kg");
  });

  it("reports the buying rhythm once there are enough purchases", async () => {
    const d = await fetchInsights();
    const rice = d.topItems.find((i) => i.itemId === riceId)!;
    // Gaps of 20, 20 and 18 days -> median 20.
    expect(rice.medianGapDays).toBe(20);
  });

  it("withholds a rate and a rhythm when the history is too thin to mean anything", async () => {
    const d = await fetchInsights();
    const salt = d.topItems.find((i) => i.itemId === saltId)!;
    expect(salt.purchases).toBe(2);
    expect(salt.medianGapDays).toBeNull(); // needs 3 purchases for 2 gaps
    expect(salt.totalSpend).toBe(5000); // the null price contributes nothing
  });

  it("ranks the most-bought item first", async () => {
    const d = await fetchInsights();
    expect(d.topItems[0]!.itemId).toBe(riceId);
  });

  it("buckets spend by week and by month with usable labels", async () => {
    const d = await fetchInsights();

    expect(d.byWeek.length).toBeGreaterThan(1);
    expect(d.byMonth.length).toBeGreaterThan(0);
    expect(d.byDay.length).toBeGreaterThan(0);

    // Weeks are keyed to a Monday; months to 'YYYY-MM'; days to 'YYYY-MM-DD'.
    expect(d.byWeek[0]!.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.byMonth[0]!.key).toMatch(/^\d{4}-\d{2}$/);
    expect(d.byDay[0]!.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.byWeek[0]!.label).toMatch(/^\d{1,2} \w{3}$/);
    expect(d.byMonth[0]!.label).toMatch(/^\w{3}$/);
    expect(d.byDay[0]!.label).toMatch(/^\d{1,2} \w{3}$/);

    // All cadences must account for the same money when within limits.
    expect(d.byWeek.reduce((s, b) => s + b.spend, 0)).toBe(d.totalSpend);
    expect(d.byMonth.reduce((s, b) => s + b.spend, 0)).toBe(d.totalSpend);
    expect(d.byDay.reduce((s, b) => s + b.spend, 0)).toBe(d.totalSpend);
  });

  it("every weekly bucket starts on a Monday", async () => {
    const d = await fetchInsights();
    for (const b of d.byWeek) {
      // Parsed as UTC midnight; getUTCDay() 1 === Monday.
      expect(new Date(`${b.key}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it("splits spend across categories", async () => {
    const d = await fetchInsights();
    expect(d.byCategory.reduce((s, c) => s + c.spend, 0)).toBe(d.totalSpend);
  });

  it("never leaks another household's purchases", async () => {
    await env.DB.prepare("INSERT INTO household (id,name,passcode_hash,created_at) VALUES (?,?,?,?)")
      .bind("other-house", "Theirs", "x", 0)
      .run();
    await env.DB.prepare(
      "INSERT INTO item (id,household_id,name,created_at) VALUES (?,?,?,?)",
    )
      .bind("other-item", "other-house", "Caviar", 0)
      .run();
    await env.DB.prepare(
      `INSERT INTO purchase (id, household_id, item_id, purchased_at, qty, unit, price_total)
       VALUES (?,?,?,?,?,?,?)`,
    )
      .bind("other-purchase", "other-house", "other-item", Math.floor(Date.now() / 1000), 1, "pcs", 999999)
      .run();

    const d = await fetchInsights();
    expect(d.totalPurchases).toBe(6);
    expect(d.topItems.some((i) => i.name === "Caviar")).toBe(false);
    expect(d.totalSpend).toBe(4 * 30000 + 5000);
  });
});

describe("utility bills stay out of spending", () => {
  // Bills are paid up front. The spend figures answer "what will the shop bill
  // be", so a wifi payment counted in them overstates it.
  it("leaves utility payments out of every total, bucket and category", async () => {
    const before = await fetchInsights();
    const cats = await (await get("/api/categories", cookie)).json<Array<{ id: string; name: string }>>();
    const utilities = cats.find((c) => c.name === "Utilities")!;
    const items = await (await get("/api/items", cookie)).json<Array<{ id: string; categoryId: string | null }>>();
    const wifi = items.find((i) => i.categoryId === utilities.id)!;
    await addPurchase(wifi.id, 1, 1, 99900);

    const after = await fetchInsights();
    expect(after.totalSpend).toBe(before.totalSpend);
    expect(after.totalPurchases).toBe(before.totalPurchases);
    expect(after.spendLast30).toBe(before.spendLast30);
    expect(after.byMonth).toEqual(before.byMonth);
    expect(after.byCategory.map((c) => c.name)).not.toContain("Utilities");
    expect(after.topItems.map((i) => i.itemId)).not.toContain(wifi.id);
  });
});
