import { useState, useEffect, useCallback } from "react";
import type { Member, Category } from "@shared/types";
import * as api from "./api";
import type { SessionResponse } from "./api";
import { useRouter } from "./hooks/useRouter";
import { readSnapshot, writeSnapshot, isOffline } from "./lib/cache";
import { ToastProvider } from "./components/Toast";
import { OutboxProvider } from "./components/Outbox";
import { SyncBanner } from "./components/SyncBanner";
import { Shell } from "./components/Shell";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { SetupScreen } from "./screens/SetupScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { ProfilePickScreen } from "./screens/ProfilePickScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { ListScreen } from "./screens/ListScreen";
import { ShopModeScreen } from "./screens/ShopModeScreen";
import { PantryScreen } from "./screens/PantryScreen";
import { UtilitiesScreen } from "./screens/UtilitiesScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { InsightsScreen } from "./screens/InsightsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

type AppState =
  | { phase: "loading" }
  | { phase: "setup" }
  | { phase: "login"; householdName: string; members: Member[] }
  | { phase: "pick_profile"; members: Member[] }
  | { phase: "ready"; memberId: string; members: Member[]; householdName: string };

/** Everything needed to open the app again without asking the server. */
interface SessionSnapshot {
  memberId: string;
  members: Member[];
  householdName: string;
  categories: Category[];
}

// Restore saved theme on load
function applyStoredTheme() {
  const stored = localStorage.getItem("pantry-theme");
  if (stored === "dark" || stored === "light") {
    document.documentElement.classList.add(stored);
  }
}

export function App() {
  const [state, setState] = useState<AppState>({ phase: "loading" });
  const [categories, setCategories] = useState<Category[]>([]);
  const { route, navigate } = useRouter();

  const boot = useCallback(async () => {
    try {
      const session: SessionResponse = await api.getSession();

      if (session.needsSetup) {
        setState({ phase: "setup" });
        return;
      }

      if (!session.authenticated) {
        setState({
          phase: "login",
          householdName: session.householdName ?? "Home",
          members: session.members ?? [],
        });
        return;
      }

      if (!session.memberId) {
        setState({ phase: "pick_profile", members: session.members ?? [] });
        return;
      }

      // Fully authed — fetch categories
      const cats = await api.getCategories();
      setCategories(cats);

      const ready = {
        memberId: session.memberId,
        members: session.members ?? [],
        householdName: session.householdName ?? "Home",
      };
      writeSnapshot<SessionSnapshot>("session", { ...ready, categories: cats });
      setState({ phase: "ready", ...ready });
    } catch (err) {
      // A failure with an HTTP status behind it is a real answer -- a dead
      // session, a household that no longer exists -- and still means log in.
      //
      // A failure with no status means the request never left the phone, which
      // is the normal state in a shop. Sending someone to a login screen they
      // cannot complete would put the app out of reach at exactly the moment
      // they walked in to use it, so the last known session opens instead.
      const snapshot = isOffline(err) ? readSnapshot<SessionSnapshot>("session") : null;
      if (snapshot) {
        setCategories(snapshot.value.categories);
        setState({
          phase: "ready",
          memberId: snapshot.value.memberId,
          members: snapshot.value.members,
          householdName: snapshot.value.householdName,
        });
        return;
      }

      setState({ phase: "login", householdName: "Home", members: [] });
    }
  }, []);

  useEffect(() => {
    applyStoredTheme();
    boot();
  }, [boot]);

  return (
    <ToastProvider>
      {state.phase === "loading" && (
        <div className="min-h-dvh flex items-center justify-center bg-surface">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {state.phase === "setup" && <SetupScreen onDone={boot} />}

      {state.phase === "login" && (
        <LoginScreen householdName={state.householdName} onDone={boot} />
      )}

      {state.phase === "pick_profile" && (
        <ProfilePickScreen members={state.members} onDone={boot} />
      )}

      {state.phase === "ready" && (
        <OutboxProvider>
        <SyncBanner />
        <Shell route={route} navigate={navigate}>
          {route.page === "today" && (
            <TodayScreen
              categories={categories}
              memberName={
                state.members.find((m) => m.id === state.memberId)?.name ?? "there"
              }
              onNavigate={navigate}
            />
          )}
          {route.page === "list" && <ListScreen categories={categories} navigate={navigate} />}
          {route.page === "shop" && <ShopModeScreen categories={categories} navigate={navigate} />}
          {route.page === "pantry" && <PantryScreen categories={categories} />}
          {route.page === "utilities" && <UtilitiesScreen categories={categories} />}
          {route.page === "insights" && <InsightsScreen categories={categories} navigate={navigate} />}
          {route.page === "history" && <HistoryScreen categories={categories} navigate={navigate} />}
          {route.page === "settings" && (
            <SettingsScreen
              currentMemberId={state.memberId}
              members={state.members}
              householdName={state.householdName}
              onRefresh={boot}
            />
          )}
        </Shell>
        </OutboxProvider>
      )}
    </ToastProvider>
  );
}
