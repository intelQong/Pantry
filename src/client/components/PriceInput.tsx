import { useState, useCallback, useRef, useEffect } from "react";
import { parseMoney, toInputValue, CURRENCY_SYMBOL } from "../lib/money";

/**
 * Inline price field. Holds what was typed, emits integer minor units.
 *
 * The field keeps the raw text while you type and only reformats when the
 * value is changed from *outside*. It used to reformat on every change, which
 * meant typing "5" emitted 500, the parent echoed 500 back, and the field
 * rewrote itself to "5.00" under the cursor -- after which the next digit made
 * "5.005", failed the two-decimal guard, and was dropped. One keystroke was
 * enough to make it unusable.
 *
 * `lastEmitted` is what distinguishes our own echo from a genuine outside
 * change; without it there is no way to tell them apart.
 */
export function PriceInput({
  value,
  onChange,
  currency = CURRENCY_SYMBOL,
  placeholder = "Price (optional)",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  currency?: string;
  placeholder?: string;
}) {
  const [display, setDisplay] = useState(() => toInputValue(value));
  const lastEmitted = useRef<number | null>(value);

  useEffect(() => {
    if (value === lastEmitted.current) return; // our own echo; leave the text alone
    lastEmitted.current = value;
    setDisplay(toInputValue(value));
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;

      // Digits with at most one dot and two decimals. A lone "." is allowed
      // through as a transient state so "." -> ".5" -> "0.5" can be typed.
      if (raw !== "" && !/^\d*\.?\d{0,2}$/.test(raw)) return;

      setDisplay(raw);
      const minor = parseMoney(raw);
      lastEmitted.current = minor;
      onChange(minor);
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-2 bg-surface-sunken rounded-lg px-3 py-2">
      <span className="text-text-secondary font-medium text-sm">{currency}</span>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label="Price"
        className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-tertiary"
      />
    </div>
  );
}
