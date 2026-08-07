/**
 * A jar that empties as an item's restock cycle runs down.
 *
 * SVG rather than divs because the contents have to be clipped to the jar's own
 * silhouette, which CSS can only fake, and because everything here is drawn in
 * `currentColor` -- so the caller picks the tone with the existing
 * `text-status-*` tokens and this component adds no CSS at all. That matters
 * more than it sounds: index.css declares dark mode twice, once behind a media
 * query and once behind `.dark`, and every literal colour has to be written
 * into both or it silently breaks in one of them.
 */

/** The jar body: shoulders, straight sides, rounded base. */
const BODY = "M9 14h22a3 3 0 0 1 3 3v22a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5V17a3 3 0 0 1 3-3Z";

/** Where a full jar's surface sits, and the inside of its base. */
const FULL_Y = 14;
const BASE_Y = 44;

/**
 * The clip path every jar shares. Rendered once per screen, not once per jar.
 *
 * A clipPath resolves in the user space of whatever references it, and every
 * jar uses the same viewBox, so one definition serves all of them -- fifty
 * copies would be fifty elements fighting over one id.
 */
export function JarClipDef() {
  return (
    <svg width="0" height="0" aria-hidden="true" className="absolute">
      <defs>
        <clipPath id="jar-body">
          <path d={BODY} />
        </clipPath>
      </defs>
    </svg>
  );
}

/**
 * @param fill 0 to 1, or null for an item with no cycle to show yet, which is
 * drawn hollow with a dashed rim rather than as an empty jar -- "nobody has
 * bought this" and "you have run out" are different things.
 */
/**
 * @param fill 0 to 1, or null for an item with no cycle to show yet.
 * @param urgent Draw at full strength. A jar that is empty or nearly so has
 * almost no liquid left to carry its colour, which would make the items that
 * need attention the faintest things on the shelf. The rim takes over instead:
 * heavier and at full opacity, so it reads as an outline drawn round something
 * rather than something that has faded out. Driven by the item's status rather
 * than by the fill hitting exactly zero, because "two days left of thirty" is
 * every bit as urgent as "due today" and has a sliver of liquid left.
 */
export function Jar({
  fill,
  urgent = false,
  className,
}: {
  fill: number | null;
  urgent?: boolean;
  className?: string;
}) {
  const height = fill === null ? 0 : (BASE_Y - FULL_Y) * fill;

  return (
    <svg viewBox="0 0 40 56" className={className} aria-hidden="true" focusable="false">
      <rect x="11" y="6" width="18" height="7" rx="2" fill="currentColor" opacity={urgent ? 0.7 : 0.35} />
      {/* The glass itself, faint, so an empty jar still reads as a jar. */}
      <path d={BODY} fill="currentColor" opacity={urgent ? 0.16 : 0.1} />
      {height > 0 && (
        <rect
          x="0"
          y={BASE_Y - height}
          width="40"
          height={height}
          fill="currentColor"
          clipPath="url(#jar-body)"
        />
      )}
      <path
        d={BODY}
        fill="none"
        stroke="currentColor"
        strokeWidth={urgent ? 2.5 : 1.5}
        opacity={urgent ? 1 : 0.55}
        strokeDasharray={fill === null ? "3 3" : undefined}
      />
    </svg>
  );
}
