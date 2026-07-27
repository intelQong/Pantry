import { useState, useCallback, useEffect } from "react";
import * as api from "../api";

type PushState =
  | "unsupported"     // Browser lacks push
  | "ios-safari"      // iOS but not installed to home screen
  | "ready"           // Can request permission
  | "denied"          // User denied
  | "subscribed"      // Active subscription
  | "error";

export function usePushSubscription() {
  const [state, setState] = useState<PushState>("ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Detect capabilities
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    // iOS Safari (not standalone) cannot request push permission
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone =
      "standalone" in navigator &&
      (navigator as unknown as { standalone: boolean }).standalone;
    if (isIOS && !isStandalone) {
      setState("ios-safari");
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    // Check if already subscribed
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) setState("subscribed");
      });
    });
  }, []);

  const subscribe = useCallback(async () => {
    try {
      // Register service worker
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Request permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }

      // Get VAPID key
      const { key } = await api.getVapidKey();
      // Convert base64url to Uint8Array
      const urlBase64ToUint8Array = (base64String: string) => {
        const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
        const raw = atob(base64);
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        return arr;
      };

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });

      const json = sub.toJSON();
      await api.subscribePush({
        endpoint: sub.endpoint,
        keys: {
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
        userAgent: navigator.userAgent,
      });

      setState("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push subscription failed");
      setState("error");
    }
  }, []);

  return { state, error, subscribe };
}
