import { useEffect } from "react";

/** Registers the service worker that keeps read chapters available offline. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
