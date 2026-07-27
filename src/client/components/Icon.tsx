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
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-7A1.5 1.5 0 0 1 5.5 10Z",
  shield: "M12 3l7.5 3v5.2c0 4.3-3 8.3-7.5 9.8-4.5-1.5-7.5-5.5-7.5-9.8V6L12 3Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 0c-3.9 0-7 2.5-7 5.6V20h14v-2.4c0-3.1-3.1-5.6-7-5.6Z",
  tag: "M3.5 12.9V5.5a2 2 0 0 1 2-2h7.4a2 2 0 0 1 1.4.6l6 6a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1-.4-.6ZM8 8.5v.01",
  chart: "M4 20V10m5 10V4m5 16v-7m5 7V8",
  close: "M6 18 18 6M6 6l12 12",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.8.3L20 21.5",
  sliders: "M4 7h9m3 0h4M4 17h4m3 0h9M14 4.5v5M9 14.5v5",
  logout: "M15 16.5V19a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 15 5v2.5M9.5 12H20m0 0-3-3m3 3-3 3",
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
