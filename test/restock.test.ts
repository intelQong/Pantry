import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  computeStatus,
  medianGapDays,
  nextInterval,
  relearnInterval,
  localParts,
  isQuietHour,
  byUrgency,
} from "../src/worker/restock";

const DAY = 86400;
const NOW = 1_800_000_000; // fixed reference instant, so tests are deterministic

describe("computeStatus", () => {
  it("is 'due' exactly at the interval boundary, not 'due_soon'", () => {
    const result = computeStatus(
      { last_purchased_at: NOW - 7 * DAY, created_at: NOW - 30 * DAY, restock_interval_days: 7 },
      2,
      NOW,
    );
    expect(result).toMatchObject({ status: "due", daysSince: 7, daysUntilDue: 0, neverPurchased: false });
  });

  it("is 'due_soon' right at the start of the lead window", () => {
    // interval - leadDays = 5, so daysSince = 5 is the first due_soon day.
    const result = computeStatus(
      { last_purchased_at: NOW - 5 * DAY, created_at: NOW - 30 * DAY, restock_interval_days: 7 },
      2,
      NOW,
    );
    expect(result.status).toBe("due_soon");
  });

  it("is 'ok' one day before the lead window opens", () => {
    const result = computeStatus(
      { last_purchased_at: NOW - 4 * DAY, created_at: NOW - 30 * DAY, restock_interval_days: 7 },
      2,
      NOW,
    );
    expect(result.status).toBe("ok");
  });

  it("is 'overdue' exactly at 1.5x the interval, not a day before", () => {
    const atThreshold = computeStatus(
      { last_purchased_at: NOW - 15 * DAY, created_at: NOW - 30 * DAY, restock_interval_days: 10 },
      2,
      NOW,
    );
    expect(atThreshold.status).toBe("overdue");

    const justBefore = computeStatus(
      { last_purchased_at: NOW - 14 * DAY, created_at: NOW - 30 * DAY, restock_interval_days: 10 },
      2,
      NOW,
    );
    expect(justBefore.status).toBe("due");
  });

  it("measures never-purchased items from created_at rather than treating them as infinitely overdue", () => {
    const result = computeStatus(
      { last_purchased_at: null, created_at: NOW - 3 * DAY, restock_interval_days: 7 },
      2,
      NOW,
    );
    expect(result).toMatchObject({ status: "ok", daysSince: 3, neverPurchased: true });
  });

  it("a freshly created pantry shows nothing as due on day one", () => {
    const result = computeStatus(
      { last_purchased_at: null, created_at: NOW, restock_interval_days: 7 },
      2,
      NOW,
    );
    expect(result).toMatchObject({ status: "ok", daysSince: 0, neverPurchased: true });
  });
});

describe("byUrgency", () => {
  it("sorts overdue, due, due_soon, then ok", () => {
    const items = [
      { status: "ok" as const },
      { status: "overdue" as const },
      { status: "due_soon" as const },
      { status: "due" as const },
    ];
    items.sort(byUrgency);
    expect(items.map((i) => i.status)).toEqual(["overdue", "due", "due_soon", "ok"]);
  });
});

describe("medianGapDays", () => {
  it("returns null with fewer than 3 purchases (fewer than 2 gaps)", () => {
    expect(medianGapDays([])).toBeNull();
    expect(medianGapDays([NOW])).toBeNull();
    expect(medianGapDays([NOW, NOW + 7 * DAY])).toBeNull();
  });

  it("takes the middle gap for an odd number of gaps", () => {
    // 4 purchases -> 3 gaps: 5, 7, 9 days
    const purchases = [0, 5 * DAY, 12 * DAY, 21 * DAY];
    expect(medianGapDays(purchases)).toBe(7);
  });

  it("averages the two middle gaps for an even number of gaps", () => {
    // 5 purchases -> 4 gaps: 5, 7, 9, 11 days -> median (7+9)/2 = 8
    const purchases = [0, 5 * DAY, 12 * DAY, 21 * DAY, 32 * DAY];
    expect(medianGapDays(purchases)).toBe(8);
  });

  it("is not dragged off by a single bulk-buy outlier, unlike a mean would be", () => {
    // A steady weekly rhythm except for one bulk buy the next day.
    const purchases = [0, 7 * DAY, 14 * DAY, 15 * DAY, 22 * DAY, 29 * DAY];
    const gaps = [7, 7, 1, 7, 7];
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length; // 5.8
    const median = medianGapDays(purchases);
    expect(median).toBe(7);
    expect(median).not.toBe(mean);
  });

  it("sorts out-of-order timestamps before differencing", () => {
    const purchases = [21 * DAY, 0, 12 * DAY, 5 * DAY];
    expect(medianGapDays(purchases)).toBe(7);
  });
});

describe("nextInterval", () => {
  it("returns null (leave it alone) when there's no median gap yet", () => {
    expect(nextInterval(7, null)).toBeNull();
  });

  it("rejects a change within the 20% guard band", () => {
    expect(nextInterval(10, 11)).toBeNull(); // 10%
  });

  it("applies a change once it exceeds 20%", () => {
    expect(nextInterval(10, 15)).toBe(15); // 50%
  });

  it("clamps the candidate to [1, 365]", () => {
    expect(nextInterval(5, 1000)).toBe(365);
    expect(nextInterval(100, 0.1)).toBe(1);
  });
});

/** Minimal household + item, with purchase rows attached separately. */
async function seedHouseholdAndItem(opts: { intervalDays?: number; intervalLocked?: boolean } = {}) {
  const householdId = crypto.randomUUID();
  const itemId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare("INSERT INTO household (id, name, passcode_hash, created_at) VALUES (?,?,?,?)").bind(
      householdId,
      "Test House",
      "pbkdf2$1$AA$AA",
      NOW,
    ),
    env.DB.prepare(
      `INSERT INTO item (id, household_id, name, restock_interval_days, interval_locked, created_at)
       VALUES (?,?,?,?,?,?)`,
    ).bind(itemId, householdId, "Rice", opts.intervalDays ?? 7, opts.intervalLocked ? 1 : 0, NOW),
  ]);

  return { householdId, itemId };
}

async function seedPurchases(itemId: string, householdId: string, timestamps: number[]) {
  await env.DB.batch(
    timestamps.map((t) =>
      env.DB.prepare("INSERT INTO purchase (id, household_id, item_id, purchased_at) VALUES (?,?,?,?)").bind(
        crypto.randomUUID(),
        householdId,
        itemId,
        t,
      ),
    ),
  );
}

async function intervalOf(itemId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT restock_interval_days AS d FROM item WHERE id = ?")
    .bind(itemId)
    .first<{ d: number }>();
  return row!.d;
}

describe("relearnInterval", () => {
  it("updates the interval when the learned rhythm has shifted enough", async () => {
    const { householdId, itemId } = await seedHouseholdAndItem({ intervalDays: 7 });
    // Median gap of 14 days is a 100% change from the current 7 -- well past the guard.
    await seedPurchases(itemId, householdId, [0, 14 * DAY, 28 * DAY, 42 * DAY]);

    await relearnInterval(env.DB, itemId, householdId);

    expect(await intervalOf(itemId)).toBe(14);
  });

  it("leaves the interval alone when interval_locked = 1, even with plenty of history", async () => {
    const { householdId, itemId } = await seedHouseholdAndItem({ intervalDays: 7, intervalLocked: true });
    await seedPurchases(itemId, householdId, [0, 14 * DAY, 28 * DAY, 42 * DAY]);

    await relearnInterval(env.DB, itemId, householdId);

    expect(await intervalOf(itemId)).toBe(7);
  });

  it("leaves the interval alone with too little purchase history", async () => {
    const { householdId, itemId } = await seedHouseholdAndItem({ intervalDays: 7 });
    await seedPurchases(itemId, householdId, [0, 14 * DAY]); // one gap only

    await relearnInterval(env.DB, itemId, householdId);

    expect(await intervalOf(itemId)).toBe(7);
  });

  it("leaves the interval alone when the shift is within the 20% guard band", async () => {
    const { householdId, itemId } = await seedHouseholdAndItem({ intervalDays: 10 });
    // Median gap ~11 days: a 10% change, inside the guard band.
    await seedPurchases(itemId, householdId, [0, 11 * DAY, 22 * DAY, 33 * DAY]);

    await relearnInterval(env.DB, itemId, householdId);

    expect(await intervalOf(itemId)).toBe(10);
  });
});

describe("isQuietHour", () => {
  it("handles a window that doesn't wrap midnight", () => {
    expect(isQuietHour(0, 1, 6)).toBe(false);
    expect(isQuietHour(1, 1, 6)).toBe(true);
    expect(isQuietHour(5, 1, 6)).toBe(true);
    expect(isQuietHour(6, 1, 6)).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    expect(isQuietHour(21, 22, 7)).toBe(false);
    expect(isQuietHour(22, 22, 7)).toBe(true);
    expect(isQuietHour(23, 22, 7)).toBe(true);
    expect(isQuietHour(0, 22, 7)).toBe(true);
    expect(isQuietHour(6, 22, 7)).toBe(true);
    expect(isQuietHour(7, 22, 7)).toBe(false);
  });
});

describe("localParts", () => {
  it("matches UTC components directly under the UTC timezone", () => {
    const instant = Date.UTC(2026, 6, 27, 14, 30, 0) / 1000; // Mon 2026-07-27 14:30 UTC
    expect(localParts(instant, "UTC")).toEqual({ date: "2026-07-27", hour: 14, isoWeekday: 1 });
  });

  it("rolls the date over correctly for a fixed-offset timezone ahead of UTC", () => {
    // 23:30 UTC on 2026-07-27 (Mon) is 05:30 the next day (Tue) in Asia/Dhaka (UTC+6).
    const instant = Date.UTC(2026, 6, 27, 23, 30, 0) / 1000;
    expect(localParts(instant, "Asia/Dhaka")).toEqual({ date: "2026-07-28", hour: 5, isoWeekday: 2 });
  });
});
