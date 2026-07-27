import { describe, it, expect } from "vitest";
import { parseQty, parseIntervalDays } from "../src/client/lib/numbers";

/**
 * Regression: the numeric fields coerced on every keystroke with
 * `Number(e.target.value) || fallback`. Number("") is 0 and 0 is falsy, so
 * clearing the field snapped it straight back to the fallback and it could
 * never be retyped. "1." collapsed to 1 for the same reason, making decimals
 * impossible on a field measured in kg.
 *
 * The fix keeps the raw string in state while typing and parses once on save,
 * which is what these functions are.
 */

describe("parseQty", () => {
  it("keeps a plain number", () => {
    expect(parseQty("5", 1)).toBe(5);
  });

  it("keeps decimals, which kg and litre quantities need", () => {
    expect(parseQty("1.5", 1)).toBe(1.5);
    expect(parseQty("0.25", 1)).toBe(0.25);
  });

  it("falls back on an empty field rather than forcing a value mid-typing", () => {
    expect(parseQty("", 1)).toBe(1);
    expect(parseQty("   ", 1)).toBe(1);
  });

  it("falls back on a half-typed decimal instead of collapsing it", () => {
    // The old code turned "1." into 1 and rewrote the input, so the user could
    // never reach "1.5". Here the transient state simply isn't committed.
    expect(parseQty(".", 1)).toBe(1);
  });

  it("rejects zero, negatives and nonsense", () => {
    expect(parseQty("0", 1)).toBe(1);
    expect(parseQty("-3", 1)).toBe(1);
    expect(parseQty("abc", 1)).toBe(1);
    expect(parseQty("Infinity", 1)).toBe(1);
  });
});

describe("parseIntervalDays", () => {
  it("keeps a whole number of days", () => {
    expect(parseIntervalDays("21", 7)).toBe(21);
  });

  it("rounds a decimal, since half a day is not a restock rhythm", () => {
    expect(parseIntervalDays("6.6", 7)).toBe(7);
    expect(parseIntervalDays("6.2", 7)).toBe(6);
  });

  it("falls back on an empty field", () => {
    expect(parseIntervalDays("", 7)).toBe(7);
  });

  it("clamps to the range the restock engine accepts", () => {
    // Matches the [1, 365] clamp in src/worker/restock.ts.
    expect(parseIntervalDays("0", 7)).toBe(1);
    expect(parseIntervalDays("-5", 7)).toBe(1);
    expect(parseIntervalDays("9999", 7)).toBe(365);
  });

  it("rejects nonsense", () => {
    expect(parseIntervalDays("abc", 7)).toBe(7);
  });
});
