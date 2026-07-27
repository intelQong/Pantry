import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-text mb-1">{title}</h3>
      {subtitle && <p className="text-sm text-text-secondary max-w-xs">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
