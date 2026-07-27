/**
 * Generated profile marks.
 *
 * Abstract geometry rather than initials or photographs, in the spirit of
 * Claude's own identity: a radial mark in a warm tone on a tinted ground. The
 * shape is chosen deterministically from the member's id, so a person keeps the
 * same mark forever without anything being stored for it.
 */

type MarkProps = { color: string };

/** Twelve tapered spokes — the closest relative of Claude's own asterisk. */
function Sunburst({ color }: MarkProps) {
  const spokes = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <g>
      {spokes.map((angle) => (
        <rect
          key={angle}
          x="47.2"
          y="14"
          width="5.6"
          height="30"
          rx="2.8"
          fill={color}
          transform={`rotate(${angle} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="7.5" fill={color} />
    </g>
  );
}

/** Six petals around a centre, softer and rounder than the sunburst. */
function Bloom({ color }: MarkProps) {
  const petals = Array.from({ length: 6 }, (_, i) => i * 60);
  return (
    <g>
      {petals.map((angle) => (
        <ellipse
          key={angle}
          cx="50"
          cy="30"
          rx="10"
          ry="18"
          fill={color}
          opacity="0.85"
          transform={`rotate(${angle} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="8" fill={color} />
    </g>
  );
}

/** Concentric arcs with a weighted dot — quieter than the other two. */
function Orbit({ color }: MarkProps) {
  return (
    <g fill="none" stroke={color} strokeLinecap="round">
      <circle cx="50" cy="50" r="9" fill={color} stroke="none" />
      <path d="M50 24a26 26 0 0 1 0 52" strokeWidth="6" />
      <path d="M50 10a40 40 0 0 0 0 80" strokeWidth="6" opacity="0.55" />
    </g>
  );
}

const MARKS = [Sunburst, Bloom, Orbit];

/** Stable small hash, so the same member always draws the same mark. */
function pick(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % MARKS.length;
}

export function Avatar({
  seed,
  color,
  className = "w-11 h-11",
}: {
  /** Anything stable per person; the member id is ideal. */
  seed: string;
  color: string;
  className?: string;
}) {
  const Mark = MARKS[pick(seed)]!;
  return (
    <span
      className={`${className} shrink-0 rounded-full overflow-hidden flex items-center justify-center`}
      // A wash of the member's own colour, so the mark sits on a related ground
      // rather than a grey disc.
      style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" className="w-[72%] h-[72%]">
        <Mark color={color} />
      </svg>
    </span>
  );
}
