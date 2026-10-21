import { useState, useEffect, useCallback } from "react";

/** One name per screen. The aliases in parseHash only keep old links working. */
export type Route = {
  page: "today" | "inventory" | "list" | "stats" | "settings" | "shop" | "history" | "utilities";
};

function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  switch (h) {
    case "add":
    case "list":      return { page: "list" };
    case "inventory":
    case "pantry":    return { page: "inventory" };
    case "stats":
    case "insights":  return { page: "stats" };
    case "shop":      return { page: "shop" };
    case "bills":
    case "utilities": return { page: "utilities" };
    case "history":   return { page: "history" };
    case "settings":  return { page: "settings" };
    default:          return { page: "today" };
  }
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((path: string) => {
    window.location.hash = `#/${path}`;
  }, []);

  return { route, navigate };
}
