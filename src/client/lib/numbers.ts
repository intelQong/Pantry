/**
 * Parsers for the numeric form fields.
 *
 * These exist because the fields used to coerce on every keystroke with
 * `Number(e.target.value) || fallback`. `Number("")` is 0, 0 is falsy, so
 * clearing the field snapped it back to the fallback and it could never be
 * retyped — and `"1."` collapsed to `1`, making decimals unreachable on a
 * field measured in kilos.
 *
 * The inputs now hold the raw string while typing and parse once on save, so
 * half-finished states like "" and "1." are simply never committed instead of
 * being rewritten under the cursor.
 */

/** A quantity: any positive number, decimals allowed (1.5 kg, 0.5 L). */
export function parseQty(raw: string, fallback: number): number {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * A restock interval in whole days, clamped to the same [1, 365] range the
 * engine enforces in src/worker/restock.ts. Keeping the clamp identical on both
 * sides means the UI can never offer a value the engine would silently reject.
 */
export function parseIntervalDays(raw: string, fallback: number): number {
  const trimmed = raw.trim();

  // An empty field means "unchanged", not "zero". Number("") is 0, which is
  // finite, so without this check clearing the field would clamp to 1 day and
  // silently start nagging every morning.
  if (trimmed === "") return fallback;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return 1;

  return Math.min(365, Math.max(1, Math.round(value)));
}
