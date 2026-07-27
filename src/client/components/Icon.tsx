/**
 * The app's icon set: inline SVG paths on a shared 24px grid, 1.75 stroke,
 * round caps and joins.
 *
 * Hand-rolled rather than pulled from a library because the app needs about a
 * dozen glyphs and shipping an icon package for that is weight with no payoff.
 * Everything renders at currentColor, so an icon inherits whatever text colour
 * it sits in and needs no per-use styling.
 */

const PATHS = {
  plus: "M12 5v14M5 12h14",
  check: "m4.5 12.75 6 6 9-13.5",
  basket: "M4 9h16l-1.4 9.3a2 2 0 0 1-2 1.7H7.4a2 2 0 0 1-2-1.7L4 9Zm4.5 0L11 3m4.5 6L13 3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 1.5",
  alert: "M12 9v4m0 3.5v.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  sun: "M12 4V2m0 20v-2m8-8h2M2 12h2m12.9-4.9 1.4-1.4M5.7 18.3l1.4-1.4m9.8 0 1.4 1.4M5.7 5.7l1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  moon: "M20 14.2A8.5 8.5 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z",
  box: "M20.5 7.3 12 3 3.5 7.3m17 0v9.4L12 21l-8.5-4.3V7.3m17 0L12 11.6M3.5 7.3 12 11.6m0 0V21",
  chevron: "m9 6 6 6-6 6",
  arrowUp: "M12 19V5m0 0-6 6m6-6 6 6",
  spark: "M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.8 2.8m5.8 5.8 2.8 2.8m0-11.4-2.8 2.8m-5.8 5.8-2.8 2.8",
  leaf: "M4 20c0-8 5-13 16-13 0 8-4.5 13-11 13H4Zm0 0c1.5-4 4-6.5 8-8.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "w-5 h-5",
  strokeWidth = 1.75,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
