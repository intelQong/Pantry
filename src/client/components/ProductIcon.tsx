import { productIcon } from "../lib/productIcon";
import { PRODUCT_ICON_PATHS } from "../lib/productIconPaths";

const SIZES = { sm: "w-6 h-6", md: "w-7 h-7", lg: "w-9 h-9" } as const;

/**
 * A product's monochrome icon, drawn in the secondary label colour the way
 * iOS draws a glyph beside a list row. Something the keyword list doesn't
 * know gets its initial in a circle, as Contacts shows a person with no photo.
 * Decorative: the name always sits beside it.
 */
export function ProductIcon({ name, size = "md" }: { name: string; size?: keyof typeof SIZES }) {
  const icon = productIcon(name);
  const paths = icon ? PRODUCT_ICON_PATHS[icon] : undefined;

  if (!paths) {
    return (
      <span
        aria-hidden="true"
        className={`${SIZES[size]} shrink-0 inline-flex items-center justify-center rounded-full border-[1.5px] border-text-tertiary text-[0.75rem] font-semibold text-text-secondary select-none`}
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="currentColor" className={`${SIZES[size]} shrink-0 text-text-secondary`}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fillRule={p.evenOdd ? "evenodd" : undefined} clipRule={p.evenOdd ? "evenodd" : undefined} />
      ))}
    </svg>
  );
}
