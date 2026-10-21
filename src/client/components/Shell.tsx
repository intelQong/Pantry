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
      {/* The notch and the tab bar are cleared here, once, so no screen can
          forget either: the tab bar is 3.25rem plus the home-indicator inset. */}
      <main
        // A new key per tab, so each tab's screen fades in as it opens.
        key={route.page}
        className="flex-1 safe-top animate-screen-in"
        style={{ paddingBottom: "calc(4.25rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {children}
      </main>
      <BottomNav current={route.page} onNavigate={handleNav} />
    </div>
  );
}
