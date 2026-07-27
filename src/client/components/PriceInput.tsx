import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Inline price input for minor currency units. Shows the amount as
 * major.minor (e.g. "120.50") and emits the integer minor unit value.
 */
export function PriceInput({
  value,
  onChange,
  currency = "৳",
  placeholder = "Price (optional)",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  currency?: string;
  placeholder?: string;
}) {
  // Display value: convert minor units to display string
  const [display, setDisplay] = useState(() =>
    value !== null ? (value / 100).toFixed(2) : "",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes
  useEffect(() => {
    if (value === null && display === "") return;
    const newDisplay = value !== null ? (value / 100).toFixed(2) : "";
    if (newDisplay !== display) setDisplay(newDisplay);
    // Only sync when value prop changes from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      // Allow empty, digits, and one decimal point
      if (raw !== "" && !/^\d*\.?\d{0,2}$/.test(raw)) return;
      setDisplay(raw);
      if (raw === "" || raw === ".") {
        onChange(null);
      } else {
        const minor = Math.round(parseFloat(raw) * 100);
        if (Number.isFinite(minor) && minor >= 0) onChange(minor);
      }
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-2 bg-surface-sunken rounded-lg px-3 py-2">
      <span className="text-text-secondary font-medium text-sm">{currency}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-tertiary"
      />
    </div>
  );
}
