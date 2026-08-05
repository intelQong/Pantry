import { describe, it, expect } from "vitest";
import { dateInputToEpochSeconds, groupByDay } from "../src/client/lib/utilities";

interface TestPurchase {
  id: string;
  purchasedAt: number;
  priceTotal: number | null;
}

const purchase = (
  id: string,
  purchasedAt: number,
  priceTotal: number | null,
): TestPurchase => ({
  id,
  purchasedAt,
  priceTotal,
});

describe("groupByDay", () => {
  it("groups purchases on the same calendar day into one group, different days produce separate groups", () => {
    const todayKey = "2026-08-05";
    const groups = groupByDay(
      [
        purchase("a", dateInputToEpochSeconds("2026-08-05"), 1000),
        purchase("b", dateInputToEpochSeconds("2026-08-05"), 2000),
        purchase("c", dateInputToEpochSeconds("2026-08-04"), 3000),
      ],
      todayKey,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.key).toBe("2026-08-05");
    expect(groups[0]!.purchases).toHaveLength(2);
    expect(groups[1]!.key).toBe("2026-08-04");
    expect(groups[1]!.purchases).toHaveLength(1);
  });

  it("returns groups with newest day first", () => {
    const todayKey = "2026-08-05";
    const groups = groupByDay(
      [
        purchase("a", dateInputToEpochSeconds("2026-08-03"), 1000),
        purchase("b", dateInputToEpochSeconds("2026-08-05"), 2000),
        purchase("c", dateInputToEpochSeconds("2026-08-04"), 3000),
      ],
      todayKey,
    );
    expect(groups.map((g) => g.key)).toEqual([
      "2026-08-05",
      "2026-08-04",
      "2026-08-03",
    ]);
  });

  it("totals the price and ignores unpriced entries (null priceTotal)", () => {
    const todayKey = "2026-08-05";
    const groups = groupByDay(
      [
        purchase("a", dateInputToEpochSeconds("2026-08-05"), 1000),
        purchase("b", dateInputToEpochSeconds("2026-08-05"), null),
        purchase("c", dateInputToEpochSeconds("2026-08-05"), 2500),
      ],
      todayKey,
    );
    expect(groups[0]!.total).toBe(3500);
  });

  it("labels the day matching todayKey as 'Today' and the previous day as 'Yesterday'", () => {
    const todayKey = "2026-08-05";
    const groups = groupByDay(
      [
        purchase("a", dateInputToEpochSeconds("2026-08-05"), 1000),
        purchase("b", dateInputToEpochSeconds("2026-08-04"), 2000),
        purchase("c", dateInputToEpochSeconds("2026-08-03"), 3000),
      ],
      todayKey,
    );
    expect(groups[0]!.label).toBe("Today");
    expect(groups[1]!.label).toBe("Yesterday");
    expect(groups[2]!.label).not.toBe("Today");
    expect(groups[2]!.label).not.toBe("Yesterday");
  });

  it("returns an empty array for no purchases", () => {
    const todayKey = "2026-08-05";
    const groups = groupByDay([], todayKey);
    expect(groups).toEqual([]);
  });
});
