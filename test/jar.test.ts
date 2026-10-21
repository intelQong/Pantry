import { describe, it, expect } from "vitest";
import { jarFill, jarCaption } from "../src/client/lib/jar";

/** Only the fields the fill maths reads. */
const cycle = (
  restockIntervalDays: number,
  daysUntilDue: number | null,
  lastPurchasedAt: number | null = 1_700_000_000,
  daysSince: number | null = 3,
) => ({ restockIntervalDays, daysUntilDue, lastPurchasedAt, daysSince });

describe("jarFill", () => {
  it("is full the day it was bought and empty the day it is due", () => {
    expect(jarFill(cycle(14, 14))).toBe(1);
    expect(jarFill(cycle(14, 0))).toBe(0);
  });

  it("runs down in proportion through the cycle", () => {
    expect(jarFill(cycle(14, 7))).toBe(0.5);
    expect(jarFill(cycle(10, 8))).toBeCloseTo(0.8);
  });

  it("clamps an overdue item to empty rather than going negative", () => {
    expect(jarFill(cycle(14, -5))).toBe(0);
    expect(jarFill(cycle(14, -100))).toBe(0);
  });

  it("clamps past full, for a phone whose clock runs ahead of the server", () => {
    expect(jarFill(cycle(14, 20))).toBe(1);
  });

  it("has nothing to draw for an item nobody has ever bought", () => {
    // The server measures daysSince from created_at in this case, which makes a
    // plausible-looking number. Drawing it would be a confident lie.
    expect(jarFill(cycle(14, 9, null))).toBeNull();
    expect(jarFill(cycle(14, null))).toBeNull();
  });

  it("has nothing to draw for a nonsense interval", () => {
    expect(jarFill(cycle(0, 5))).toBeNull();
    expect(jarFill(cycle(-7, 5))).toBeNull();
    expect(jarFill(cycle(Number.NaN, 5))).toBeNull();
  });
});

describe("jarCaption", () => {
  it("counts down, then names the day, then counts up", () => {
    expect(jarCaption(cycle(14, 8))).toBe("8d left");
    expect(jarCaption(cycle(14, 1))).toBe("1d left");
    expect(jarCaption(cycle(14, 0))).toBe("due today");
    expect(jarCaption(cycle(14, -5))).toBe("5d late");
  });

  it("says so when the item has never been bought", () => {
    expect(jarCaption(cycle(14, 9, null))).toBe("not bought yet");
  });

  it("says how long ago, not 'due today', for something with no due date", () => {
    // A non-staple is never due; null used to fall through to "due today".
    expect(jarCaption(cycle(14, null, 1_700_000_000, 12))).toBe("12d ago");
  });
});
