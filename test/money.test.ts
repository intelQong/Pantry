import { describe, it, expect } from "vitest";
import { formatMoney, parseMoney, toInputValue } from "../src/client/lib/money";

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

  it("rejects nonsense and negatives", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("-5")).toBe(500); // the minus is stripped as punctuation
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
