import { describe, it, expect } from "vitest";
import {
  dateInputToEpochSeconds,
  epochSecondsToDateInput,
  groupByMonth,
  getNextMonthLabel,
  getMonthName,
  groupMonthlyBills,
  findDuplicatePurchases,
  findHistoryDuplicate,
} from "../src/client/lib/utilities";
import type { Purchase } from "../src/shared/types";

const purchase = (
  id: string,
  purchasedAt: number,
  priceTotal: number | null,
  itemId = "item-1",
): Purchase => ({
  id,
  itemId,
  purchasedAt,
  qty: 1,
  unit: "cylinder",
  priceTotal,
  boughtBy: null,
  note: null,
});

describe("date input round trip", () => {
  it("survives a round trip", () => {
    expect(epochSecondsToDateInput(dateInputToEpochSeconds("2026-07-14"))).toBe("2026-07-14");
  });

  it("returns whole seconds, not milliseconds", () => {
    const seconds = dateInputToEpochSeconds("2026-07-14");
    expect(Number.isInteger(seconds)).toBe(true);
    // Sanity: anything in ms would be ~1000x larger than a 2026 timestamp.
    expect(seconds).toBeLessThan(4_000_000_000);
  });

  it("zero-pads single-digit months and days", () => {
    expect(epochSecondsToDateInput(dateInputToEpochSeconds("2026-01-05"))).toBe("2026-01-05");
  });
});

describe("groupByMonth", () => {
  it("groups by calendar month, newest month first", () => {
    const groups = groupByMonth([
      purchase("a", dateInputToEpochSeconds("2026-06-02"), 12000),
      purchase("b", dateInputToEpochSeconds("2026-07-14"), 34000),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-07", "2026-06"]);
  });

  it("orders purchases newest first inside a month", () => {
    const groups = groupByMonth([
      purchase("early", dateInputToEpochSeconds("2026-07-02"), 100),
      purchase("late", dateInputToEpochSeconds("2026-07-28"), 100),
    ]);
    expect(groups[0]!.purchases.map((p) => p.id)).toEqual(["late", "early"]);
  });

  it("totals the month in minor units and ignores unpriced entries", () => {
    const groups = groupByMonth([
      purchase("a", dateInputToEpochSeconds("2026-07-02"), 12000),
      purchase("b", dateInputToEpochSeconds("2026-07-03"), null),
      purchase("c", dateInputToEpochSeconds("2026-07-04"), 34050),
    ]);
    expect(groups[0]!.total).toBe(46050);
  });

  it("returns an empty array for no purchases", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("getNextMonthLabel and getMonthName", () => {
  it("returns next month label across standard months and year rollover", () => {
    expect(getNextMonthLabel("2026-09")).toContain("October");
    expect(getNextMonthLabel("2026-12")).toContain("January");
    expect(getNextMonthLabel("2026-12")).toContain("2027");
  });

  it("returns current month name", () => {
    expect(getMonthName("2026-09")).toBe("September");
    expect(getMonthName("2026-01")).toBe("January");
  });
});

describe("groupMonthlyBills", () => {
  it("separates grocery purchases from utility purchases and calculates their totals", () => {
    const utilityIds = new Set(["gas-id", "wifi-id"]);
    const currentMonth = "2026-09";

    const purchases = [
      // September: 1 grocery (৳200), 1 utility (৳500), 1 unpriced grocery
      purchase("sep-g1", dateInputToEpochSeconds("2026-09-10"), 20000, "rice-id"),
      purchase("sep-g2", dateInputToEpochSeconds("2026-09-12"), null, "salt-id"),
      purchase("sep-u1", dateInputToEpochSeconds("2026-09-15"), 50000, "wifi-id"),
      // August: 2 groceries (৳100, ৳300), 1 utility (৳1000)
      purchase("aug-g1", dateInputToEpochSeconds("2026-08-01"), 10000, "flour-id"),
      purchase("aug-g2", dateInputToEpochSeconds("2026-08-05"), 30000, "oil-id"),
      purchase("aug-u1", dateInputToEpochSeconds("2026-08-20"), 100000, "gas-id"),
    ];

    const bills = groupMonthlyBills(purchases, utilityIds, currentMonth);

    expect(bills).toHaveLength(2);
    // Newest month first
    expect(bills[0]!.key).toBe("2026-09");
    expect(bills[0]!.groceryTotal).toBe(20000); // ৳200
    expect(bills[0]!.groceryPurchases).toHaveLength(2);
    expect(bills[0]!.utilityTotal).toBe(50000); // ৳500
    expect(bills[0]!.utilityPurchases).toHaveLength(1);
    // No combined figure: bills are paid up front, so adding them to the shop
    // bill would overstate what is owed.
    expect(bills[0]).not.toHaveProperty("totalSpend");
    expect(bills[0]!.nextMonthLabel).toContain("October");

    // August
    expect(bills[1]!.key).toBe("2026-08");
    expect(bills[1]!.groceryTotal).toBe(40000); // ৳400 (bill to be paid in September)
    expect(bills[1]!.utilityTotal).toBe(100000); // ৳1000
    expect(bills[1]!.nextMonthLabel).toContain("September");
  });

  it("always includes current month even if no purchases exist yet", () => {
    const utilityIds = new Set(["gas-id"]);
    const currentMonth = "2026-10";
    const bills = groupMonthlyBills([], utilityIds, currentMonth);

    expect(bills).toHaveLength(1);
    expect(bills[0]!.key).toBe("2026-10");
    expect(bills[0]!.groceryTotal).toBe(0);
    expect(bills[0]!.utilityTotal).toBe(0);
    expect(bills[0]!.nextMonthLabel).toContain("November");
  });
});

describe("findDuplicatePurchases", () => {
  it("finds purchases on the same date with the exact same price", () => {
    const list = [
      purchase("p1", dateInputToEpochSeconds("2026-09-30"), 25000),
      purchase("p2", dateInputToEpochSeconds("2026-09-30"), 10000),
      purchase("p3", dateInputToEpochSeconds("2026-09-29"), 25000),
    ];

    const dupes = findDuplicatePurchases(list, "2026-09-30", 25000);
    expect(dupes.map((d) => d.id)).toEqual(["p1"]);
  });

  it("returns multiple matches if multiple purchases match date and amount", () => {
    const list = [
      purchase("p1", dateInputToEpochSeconds("2026-09-30"), 15000),
      purchase("p2", dateInputToEpochSeconds("2026-09-30"), 15000),
      purchase("p3", dateInputToEpochSeconds("2026-09-30"), 30000),
    ];

    const dupes = findDuplicatePurchases(list, "2026-09-30", 15000);
    expect(dupes.map((d) => d.id)).toEqual(["p1", "p2"]);
  });

  it("returns empty array when amounts or dates differ", () => {
    const list = [
      purchase("p1", dateInputToEpochSeconds("2026-09-30"), 25000),
    ];

    expect(findDuplicatePurchases(list, "2026-09-29", 25000)).toEqual([]);
    expect(findDuplicatePurchases(list, "2026-09-30", 26000)).toEqual([]);
    expect(findDuplicatePurchases(list, "2026-09-30", 0)).toEqual([]);
  });

  it("handles empty purchases list", () => {
    expect(findDuplicatePurchases([], "2026-09-30", 25000)).toEqual([]);
  });
});

describe("findHistoryDuplicate", () => {
  it("detects when billTotal matches an existing recorded purchase on that date", () => {
    const list = [
      purchase("p1", dateInputToEpochSeconds("2026-09-29"), null),
      purchase("p2", dateInputToEpochSeconds("2026-09-29"), null),
      purchase("p3-manual", dateInputToEpochSeconds("2026-09-29"), 50000), // manual entry ৳500
    ];

    const match = findHistoryDuplicate(list, {}, 50000);
    expect(match).not.toBeNull();
    expect(match?.matchedPurchase.id).toBe("p3-manual");
    expect(match?.amount).toBe(50000);
    expect(match?.reason).toBe("bill_total");
  });

  it("detects when an individual item's newly allocated price matches an existing recorded purchase", () => {
    const list = [
      purchase("p1", dateInputToEpochSeconds("2026-09-29"), null),
      purchase("p2", dateInputToEpochSeconds("2026-09-29"), null),
      purchase("p3-manual", dateInputToEpochSeconds("2026-09-29"), 30000), // ৳300
    ];

    const match = findHistoryDuplicate(list, { p1: 30000 }, null);
    expect(match).not.toBeNull();
    expect(match?.matchedPurchase.id).toBe("p3-manual");
    expect(match?.amount).toBe(30000);
    expect(match?.reason).toBe("item_price");
  });

  it("detects when the sum of newly priced items matches an existing recorded purchase", () => {
    const list = [
      purchase("p1", dateInputToEpochSeconds("2026-09-29"), null),
      purchase("p2", dateInputToEpochSeconds("2026-09-29"), null),
      purchase("p3-manual", dateInputToEpochSeconds("2026-09-29"), 50000), // ৳500
    ];

    const match = findHistoryDuplicate(list, { p1: 20000, p2: 30000 }, null);
    expect(match).not.toBeNull();
    expect(match?.matchedPurchase.id).toBe("p3-manual");
    expect(match?.amount).toBe(50000);
    expect(match?.reason).toBe("sum_total");
  });

  it("does not flag duplicate if an item's price has not changed", () => {
    const list = [
      purchase("p1", dateInputToEpochSeconds("2026-09-29"), 25000),
      purchase("p2", dateInputToEpochSeconds("2026-09-29"), 10000),
    ];

    // User re-saves without changing p1's price
    const match = findHistoryDuplicate(list, { p1: 25000 }, null);
    expect(match).toBeNull();
  });

  it("returns null when no prices match", () => {
    const list = [
      purchase("p1", dateInputToEpochSeconds("2026-09-29"), null),
      purchase("p2", dateInputToEpochSeconds("2026-09-29"), 10000),
    ];

    expect(findHistoryDuplicate(list, { p1: 15000 }, 15000)).toBeNull();
    expect(findHistoryDuplicate(list, {}, null)).toBeNull();
  });
});


