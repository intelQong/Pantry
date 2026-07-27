import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-surface-sunken text-text-tertiary flex items-center justify-center mb-4">
        <Icon name={icon} className="w-6 h-6" />
      </div>
      <h3 className="font-display text-lg font-semibold text-text mb-1">{title}</h3>
      {subtitle && <p className="text-sm text-text-secondary max-w-xs">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
