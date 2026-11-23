import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

/** Paths the collector never records: the Admin and API are not read pages. */
const UNTRACKED = /^\/(admin|api|login|auth)(\/|$)/;

/**
 * Reports each public page a visitor opens to this site's own collector
 * (`/api/track`). One report per page load and per chapter of a novel; nothing
 * is sent from the Admin or while previewing a Theme.
 */
export function PageViewTracker() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const searchStr = useLocation({ select: (location) => location.searchStr });
  const reported = useRef<string | null>(null);

  useEffect(() => {
    // A reader moves through chapters by changing the query, not the path, so
    // every chapter is its own page view.
    const key = `${pathname}?${searchStr}`;
    if (reported.current === key) return;
    reported.current = key;

    if (UNTRACKED.test(pathname)) return;
    const search = new URLSearchParams(searchStr.replace(/^\?/u, ""));
    if (search.has("themePreview")) return;

    const isNovelRead = /^\/novels\/[^/]+\/read$/.exec(pathname) !== null;
    const chapter = isNovelRead ? Number(search.get("chapter")) : NaN;
    const body = JSON.stringify({
      path: pathname,
      referrer: document.referrer,
      chapter: Number.isInteger(chapter) && chapter > 0 ? chapter : null,
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
  }, [pathname, searchStr]);

  return null;
}
