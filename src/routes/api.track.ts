import { createFileRoute } from "@tanstack/react-router";
import {
  deviceOf,
  externalReferrerHost,
  isBotUserAgent,
  normalizeTrackedPath,
  postSlugOfPath,
  visitorCookieHeader,
  visitorIdFromCookie,
} from "@/features/analytics/analytics";
import { insertPageView } from "@/features/analytics/data/analytics.data";
import {
  findReadyNovelById,
  findReadyNovelBySlug,
} from "@/features/novels/data/novels.data";
import { getDb } from "@/lib/db";

const NOVEL_READ_PATH = /^\/novels\/([^/]+)\/read$/u;

/** URLs carry the book's title; a legacy numeric URL still names its id. */
async function novelIdOfPath(db: DB, path: string) {
  const raw = NOVEL_READ_PATH.exec(path)?.[1];
  if (!raw) return null;
  let slug = raw;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    // An unreadable escape is simply a slug that will not match.
  }
  const novel =
    (await findReadyNovelBySlug(db, slug)) ??
    (/^\d+$/u.test(slug) ? await findReadyNovelById(db, Number(slug)) : null);
  return novel?.id ?? null;
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

function noContent(setCookie: string | null = null) {
  return new Response(null, {
    status: 204,
    headers: setCookie
      ? { ...NO_STORE, "Set-Cookie": setCookie }
      : { ...NO_STORE },
  });
}

/** A trimmed string from Cloudflare's request metadata, or null. */
function metadataText(value: unknown, limit = 100): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, limit);
}

/**
 * The site's own page view collector: the public layout posts each page a
 * visitor opens here, and this Worker alone records it in D1. Nothing leaves
 * for a third-party analytics service.
 */
export const Route = createFileRoute("/api/track")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        // The Rate Limiter's binding loads only for requests that reach it.
        const { enforceIpRateLimit } = await import("@/lib/http/rate-limit");
        const limited = await enforceIpRateLimit(request, {
          capacity: 120,
          interval: "1m",
          key: "page-view",
        });
        if (limited) return limited;

        let body: {
          path?: unknown;
          referrer?: unknown;
          novelId?: unknown;
          chapter?: unknown;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return noContent();
        }

        const path = normalizeTrackedPath(body.path);
        const userAgent = request.headers.get("user-agent");
        if (!path || isBotUserAgent(userAgent)) return noContent();

        const db = getDb(context.env);

        // Signed-in visitors are told apart by account; everyone else by an
        // anonymous uuid in their own cookie. No IP address is stored. Better
        // Auth's server code loads only for requests that reach it.
        const { getRequestAuth } = await import("@/lib/auth/auth.server");
        const session = await getRequestAuth({
          db,
          env: context.env,
          executionCtx: context.executionCtx,
        })
          .api.getSession({ headers: request.headers })
          .catch(() => null);

        let setCookie: string | null = null;
        let visitorId: string;
        if (session?.user?.id) {
          visitorId = `user:${session.user.id}`;
        } else {
          const known = visitorIdFromCookie(request.headers.get("cookie"));
          const uuid = known ?? crypto.randomUUID();
          if (!known) setCookie = visitorCookieHeader(uuid);
          visitorId = `anon:${uuid}`;
        }

        try {
          const isNovelRead = NOVEL_READ_PATH.test(path);
          const knownNovelId =
            typeof body.novelId === "number" &&
            Number.isInteger(body.novelId) &&
            body.novelId > 0
              ? body.novelId
              : null;
          const novelId = isNovelRead
            ? (knownNovelId ?? (await novelIdOfPath(db, path)))
            : null;
          const chapter =
            typeof body.chapter === "number" &&
            Number.isInteger(body.chapter) &&
            body.chapter > 0
              ? body.chapter
              : null;
          await insertPageView(db, {
            path,
            postSlug: postSlugOfPath(path),
            novelId,
            novelChapter: novelId ? chapter : null,
            visitorId,
            country: metadataText(context.geo?.country),
            region: metadataText(context.geo?.region),
            city: metadataText(context.geo?.city),
            referrerHost: externalReferrerHost(
              body.referrer,
              new URL(request.url).hostname,
            ),
            device: deviceOf(userAgent),
          });
        } catch (error) {
          // A page view is never worth failing a visitor's page over.
          console.error(
            JSON.stringify({
              message: "page view insert failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        return noContent(setCookie);
      },
    },
  },
});
