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
  const cleaned = input.replace(/[^\d.]/g, "").trim();
  if (!cleaned) return null;

  const major = Number(cleaned);
  if (!Number.isFinite(major) || major < 0) return null;

  return Math.round(major * 100);
}

/** 1235 -> "12.35" for prefilling an input, without the symbol. */
export function toInputValue(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return "";
  const major = minorUnits / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}
