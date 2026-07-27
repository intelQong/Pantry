import { useState, useEffect, useCallback } from "react";

export type Route =
  | { page: "today" }
  | { page: "list" }
  | { page: "shop" }
  | { page: "pantry" }
  | { page: "insights" }
  | { page: "settings" }
  | { page: "item"; id: string };

function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  if (h.startsWith("items/")) {
    const id = h.slice(6);
    if (id) return { page: "item", id };
  }
  switch (h) {
    case "list":     return { page: "list" };
    case "shop":     return { page: "shop" };
    case "pantry":   return { page: "pantry" };
    case "insights": return { page: "insights" };
    case "settings": return { page: "settings" };
    default:         return { page: "today" };
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
