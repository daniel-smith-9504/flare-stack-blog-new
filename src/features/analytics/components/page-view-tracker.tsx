import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

/** Paths the collector never records: the Admin and API are not read pages. */
const UNTRACKED = /^\/(admin|api|login|auth)(\/|$)/;

/**
 * Reports each public page a visitor opens to this site's own collector
 * (`/api/track`). One report per path per page load; nothing is sent from the
 * Admin or while previewing a Theme.
 */
export function PageViewTracker() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (reported.current === pathname) return;
    reported.current = pathname;

    if (UNTRACKED.test(pathname)) return;
    if (new URLSearchParams(window.location.search).has("themePreview")) {
      return;
    }

    const body = JSON.stringify({
      path: pathname,
      referrer: document.referrer,
    });
    try {
      const queued = navigator.sendBeacon?.(
        "/api/track",
        new Blob([body], { type: "application/json" }),
      );
      if (!queued) {
        void fetch("/api/track", {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        }).catch(() => undefined);
      }
    } catch {
      // The visitor's page is not affected by a failed report.
    }
  }, [pathname]);

  return null;
}
