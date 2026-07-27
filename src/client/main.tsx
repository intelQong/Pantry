import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register at startup, not lazily when the user opts into notifications.
// `navigator.serviceWorker.ready` never resolves until something registers, so
// deferring it left the "am I already subscribed?" check hanging forever and a
// returning user always saw the un-subscribed state. Registration is also what
// makes the app installable, which on iOS is a precondition for push at all.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}
