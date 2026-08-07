/**
 * Money is stored everywhere as an integer count of minor units — poisha, of
 * which there are 100 to the taka. Nothing in the app ever holds a float:
 * ৳12.35 is 1235, and it stays 1235 until the moment it is displayed.
 */

export const CURRENCY_SYMBOL = "৳";

/** 1235 -> "৳12.35", 34000 -> "৳340". Whole amounts drop the decimals. */
export function formatMoney(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return "—";
  const major = minorUnits / 100;
  return `${CURRENCY_SYMBOL}${
    Number.isInteger(major) ? major.toLocaleString() : major.toFixed(2)
  }`;
}

/**
 * Parses what someone typed into minor units. Accepts "340", "340.5", "৳340",
 * and "1,200". Returns null for empty input — meaning "no price recorded",
 * which is a real state and distinct from zero.
 *
 * Rounds rather than truncates so "12.345" lands on 1235 instead of silently
 * losing a poisha.
 */
export function parseMoney(input: string): number | null {
  // Only the currency symbol, thousands separators and surrounding space are
  // stripped. Deleting every non-digit instead -- which this used to do -- also
  // deleted the minus sign and the exponent, so the `major < 0` guard below
  // could never fire: "-5" arrived as "5" and was charged as ৳5, and "1e9"
  // arrived as "19".
  const cleaned = input.replace(/[৳,\s]/g, "");
  if (!cleaned) return null;

  // A plain decimal number and nothing else. Rejects "1e9", "-5", "12.5.5",
  // "abc" and "1/2" outright rather than salvaging a number from them.
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return null;

  const major = Number(cleaned);
  if (!Number.isFinite(major) || major < 0) return null;

  return Math.round(major * 100);
}

/**
 * Spreads a bill total across the things it paid for.
 *
 * The problem it solves: you get home with a receipt for ৳1200 and four items,
 * and you remember what the rice cost but not the rest. Prices you do remember
 * are *pinned* — they are taken as given, and only what is left over is divided
 * between the ones you don't. Pin another and the rest re-divides, so the guess
 * gets narrower every time you remember something.
 *
 * Everything is in minor units and stays integral: the shares are floored and
 * the last unpinned item absorbs the leftover poisha, so the parts always add
 * back up to exactly the total. Splitting evenly and rounding each share would
 * quietly invent or destroy a few poisha on most receipts.
 *
 * Pins totalling more than the bill leave nothing to divide. Rather than
 * inventing negative prices, every unpinned item gets zero — the caller can see
 * the overshoot for itself by summing the pins, and should say so.
 */
export function allocateTotal(
  total: number,
  ids: string[],
  pinned: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const free: string[] = [];
  let pinnedSum = 0;

  for (const id of ids) {
    const pin = pinned[id];
    if (pin === undefined) free.push(id);
    else {
      out[id] = pin;
      pinnedSum += pin;
    }
  }

  if (free.length === 0) return out;

  const remaining = total - pinnedSum;
  if (remaining <= 0) {
    for (const id of free) out[id] = 0;
    return out;
  }

  const share = Math.floor(remaining / free.length);
  for (const id of free) out[id] = share;
  // The last one takes the remainder, so the parts sum to the total exactly.
  out[free[free.length - 1]!] = remaining - share * (free.length - 1);

  return out;
}

/** 1235 -> "12.35" for prefilling an input, without the symbol. */
export function toInputValue(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return "";
  const major = minorUnits / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}
