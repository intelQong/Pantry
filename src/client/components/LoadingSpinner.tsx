export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const px = { sm: "w-5 h-5", md: "w-8 h-8", lg: "w-12 h-12" }[size];
  return (
    <div className="flex items-center justify-center py-12">
      <div
        className={`${px} rounded-full border-2 border-border border-t-accent-500`}
        style={{ animation: "spin 0.7s linear infinite" }}
      />
    </div>
  );
}
