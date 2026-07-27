import { type ReactNode, useCallback } from "react";
import { BottomNav } from "./BottomNav";
import type { Route } from "../hooks/useRouter";

export function Shell({
  route,
  navigate,
  children,
}: {
  route: Route;
  navigate: (path: string) => void;
  children: ReactNode;
}) {
  const handleNav = useCallback(
    (page: string) => navigate(page),
    [navigate],
  );

  // Shop mode is full-screen, no shell chrome
  if (route.page === "shop") {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col min-h-dvh bg-surface">
      {/* Content area, pad for bottom nav */}
      <main className="flex-1 pb-20">{children}</main>
      <BottomNav current={route.page} onNavigate={handleNav} />
    </div>
  );
}
