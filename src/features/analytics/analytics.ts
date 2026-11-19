import { postSlugFromPath } from "@/features/post-popularity/post-popularity";
import type { PageViewDevice } from "@/lib/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The visitor cookie's name; also what the tracker sets. */
export const VISITOR_COOKIE = "pv_id";
export const VISITOR_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export const ANALYTICS_RANGE_DAYS = [7, 30, 90] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Paths that are never a page a visitor reads. */
const UNTRACKED_PREFIXES = ["/admin", "/api", "/login", "/auth"];

const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|headless|phantomjs|lighthouse|monitor|uptime|curl\/|wget\/|python-requests|facebookexternalhit|semrush|ahrefs/i;

/** A normalized pathname, or null when it is not a page worth counting. */
export function normalizeTrackedPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return null;
  }

  let pathname: string;
  try {
    pathname = new URL(raw, "https://analytics.invalid").pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;

  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path.length > 300) return null;
  if (
    UNTRACKED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) {
    return null;
  }
  return path;
}

export function isBotUserAgent(userAgent: string | null): boolean {
  return userAgent === null || BOT_PATTERN.test(userAgent);
}

export function deviceOf(userAgent: string | null): PageViewDevice {
  const ua = userAgent ?? "";
  if (/ipad|tablet|playbook|silk|kindle/i.test(ua)) return "tablet";
  if (/mobile|android|iphone|ipod|windows phone|opera mini/i.test(ua)) {
    return "mobile";
  }
  return "desktop";
}

/** The host of a link from another site, else null. */
export function externalReferrerHost(
  referrer: unknown,
  selfHost: string | null,
): string | null {
  if (typeof referrer !== "string" || referrer.length === 0) return null;
  if (referrer.length > 2048) return null;

  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  if (selfHost && host === selfHost.toLowerCase()) return null;
  return host.slice(0, 100);
}

/** The anonymous visitor id from the Cookie header, when it is well formed. */
export function visitorIdFromCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== VISITOR_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return UUID_PATTERN.test(value) ? value : null;
  }
  return null;
}

export function visitorCookieHeader(visitorUuid: string): string {
  return `${VISITOR_COOKIE}=${visitorUuid}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

/** The slug of a Post page's path, for the per-Post totals. */
export function postSlugOfPath(path: string): string | null {
  return postSlugFromPath(path);
}

/**
 * Midnight of the first of the trailing `days` calendar days, today included,
 * so the daily series has one point per day of the range.
 */
export function analyticsSince(days: number, now = Date.now()): Date {
  return new Date(utcDayStart(now - (days - 1) * DAY_MS));
}

/** UTC midnight of the day `timestamp` falls in, in milliseconds. */
export function utcDayStart(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}
