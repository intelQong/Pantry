export function CategoryBadge({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-sunken"
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  );
}
