/**
 * The tote-bag mark from the app icon, inlined so the auth screens can open on
 * the product's own symbol rather than a stock padlock. Inherits currentColor.
 */
export function BrandMark({ className = "w-11 h-11" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <path
        d="M190 210a66 66 0 0 1 132 0"
        stroke="currentColor"
        strokeWidth={26}
        strokeLinecap="round"
      />
      <rect x="138" y="215" width="236" height="205" rx="28" fill="currentColor" />
      <rect x="217" y="277" width="78" height="29" rx="14" className="fill-surface" />
    </svg>
  );
}
