import { describe, it, expect } from "vitest";
import {
  dateInputToEpochSeconds,
  epochSecondsToDateInput,
  groupByMonth,
} from "../src/client/lib/utilities";
import type { Purchase } from "../src/shared/types";

const purchase = (id: string, purchasedAt: number, priceTotal: number | null): Purchase => ({
  id,
  itemId: "item-1",
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
