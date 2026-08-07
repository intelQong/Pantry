import { describe, it, expect } from "vitest";
import { formatMoney, parseMoney, toInputValue, allocateTotal } from "../src/client/lib/money";

/**
 * Every amount in the app is an integer count of poisha. These are the only
 * two places it crosses into and out of human-readable form, so the round trip
 * has to hold exactly -- a lost poisha here becomes a wrong monthly total.
 */

describe("formatMoney", () => {
  it("drops the decimals on whole amounts", () => {
    expect(formatMoney(34000)).toBe("৳340");
    expect(formatMoney(0)).toBe("৳0");
  });

  it("keeps two decimals when there are poisha", () => {
    expect(formatMoney(1235)).toBe("৳12.35");
    expect(formatMoney(5)).toBe("৳0.05");
  });

  it("shows a dash when nothing was recorded, which is not the same as zero", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });
});

describe("parseMoney", () => {
  it("reads plain amounts", () => {
    expect(parseMoney("340")).toBe(34000);
    expect(parseMoney("12.35")).toBe(1235);
  });

  it("tolerates what people actually type", () => {
    expect(parseMoney("৳340")).toBe(34000);
    expect(parseMoney("1,200")).toBe(120000);
    expect(parseMoney(" 25 ")).toBe(2500);
  });

  it("returns null for empty input rather than zero", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
    expect(parseMoney("৳")).toBeNull();
  });

  it("rounds rather than truncates, so no poisha is silently lost", () => {
    expect(parseMoney("12.345")).toBe(1235);
    expect(parseMoney("0.006")).toBe(1);
  });

  it("rejects nonsense and negatives instead of salvaging a number", () => {
    expect(parseMoney("abc")).toBeNull();
    // Stripping every non-digit used to turn these into confident prices: the
    // minus vanished and "-5" was charged as ৳5, while "1e9" became ৳19.
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("1e9")).toBeNull();
    expect(parseMoney("12.5.5")).toBeNull();
    expect(parseMoney("1/2")).toBeNull();
    expect(parseMoney(".")).toBeNull();
  });

  it("still accepts what someone actually types", () => {
    expect(parseMoney("৳1,200")).toBe(120000);
    expect(parseMoney(" 340 ")).toBe(34000);
    expect(parseMoney("340.5")).toBe(34050);
    expect(parseMoney(".5")).toBe(50);
  });
});

describe("toInputValue", () => {
  /**
   * Regression: PriceInput formatted with .toFixed(2), so the moment you typed
   * "5" the parent echoed 500 back and the field rewrote itself to "5.00".
   * The next digit made "5.005", which failed its own 2-decimal guard and was
   * dropped -- the field became unusable after a single keystroke.
   */
  it("gives a whole amount back without decimals to type against", () => {
    expect(toInputValue(500)).toBe("5");
    expect(toInputValue(34000)).toBe("340");
  });

  it("keeps the poisha when there are any", () => {
    expect(toInputValue(1235)).toBe("12.35");
  });

  it("is empty when nothing is recorded", () => {
    expect(toInputValue(null)).toBe("");
    expect(toInputValue(undefined)).toBe("");
  });

  it("round-trips through parseMoney unchanged", () => {
    // Including 0: an explicit zero survives as 0, distinct from the null that
    // an empty field produces. "it was free" and "we didn't record it" are
    // different facts and the round trip must not merge them.
    for (const minor of [0, 1, 5, 500, 1235, 34000, 120000]) {
      expect(parseMoney(toInputValue(minor))).toBe(minor);
    }
  });
});

describe("allocateTotal", () => {
  const ids = ["rice", "milk", "onions", "chicken"];

  it("divides evenly when nothing is remembered", () => {
    expect(allocateTotal(120000, ids, {})).toEqual({
      rice: 30000, milk: 30000, onions: 30000, chicken: 30000,
    });
  });

  it("holds a remembered price and re-divides the rest", () => {
    const out = allocateTotal(120000, ids, { rice: 50000 });
    expect(out.rice).toBe(50000);
    // 70000 across three: 23333 each, the last taking the odd poisha.
    expect(out.milk).toBe(23333);
    expect(out.onions).toBe(23333);
    expect(out.chicken).toBe(23334);
  });

  it("adds back up to the total exactly, whatever does not divide evenly", () => {
    // Only claimed while the pins still leave something to divide -- once they
    // exceed the bill there is no total left to reconstruct.
    for (const total of [100000, 100001, 99999, 3001, 7]) {
      const cases: Record<string, number>[] = [{}, { rice: 5 }, { rice: 5, milk: 2 }];
      for (const pins of cases) {
        const out = allocateTotal(total, ids, pins);
        const sum = ids.reduce((n, id) => n + out[id]!, 0);
        expect(sum).toBe(total);
      }
    }
  });

  it("leaves nothing to divide when the remembered prices already cover it", () => {
    // Not negative prices: the caller sums the pins to see the overshoot.
    const out = allocateTotal(50000, ids, { rice: 50000 });
    expect(out).toEqual({ rice: 50000, milk: 0, onions: 0, chicken: 0 });

    const over = allocateTotal(10000, ids, { rice: 50000 });
    expect(over.milk).toBe(0);
    expect(over.chicken).toBe(0);
  });

  it("returns the pins untouched when every price is remembered", () => {
    const pins = { rice: 100, milk: 200, onions: 300, chicken: 400 };
    expect(allocateTotal(999999, ids, pins)).toEqual(pins);
  });

  it("gives a single unpinned item the whole remainder", () => {
    expect(allocateTotal(1000, ["a"], {})).toEqual({ a: 1000 });
  });
});
