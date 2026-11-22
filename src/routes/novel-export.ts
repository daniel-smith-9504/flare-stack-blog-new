import { createFileRoute } from "@tanstack/react-router";
import {
  exportChapterText,
  exportNovelText,
} from "@/features/novels/services/novels.service";
import { getDb } from "@/lib/db";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

function safeFilename(name: string) {
  return (name.replace(/[\\/:*?"<>|]/gu, "_").trim() || "novel").slice(0, 120);
}

/** Downloads one chapter or the whole book as a TXT file, for an Admin. */
export const Route = createFileRoute("/novel-export")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        const db = getDb(context.env);
        const { getRequestAuth } = await import("@/lib/auth/auth.server");
        const session = await getRequestAuth({
          db,
          env: context.env,
          executionCtx: context.executionCtx,
        })
          .api.getSession({ headers: request.headers })
          .catch(() => null);
        if (session?.user.role !== "admin")
          return fail("Only an Admin may export a novel.", 403);

        const url = new URL(request.url);
        const novelId = Number(url.searchParams.get("novelId"));
        const chapter = Number(url.searchParams.get("chapter"));
        if (!Number.isInteger(novelId) || novelId <= 0)
          return fail("novelId must be a positive integer.", 400);

        if (Number.isInteger(chapter) && chapter > 0) {
          const found = await exportChapterText(
            { env: context.env, db },
            novelId,
            chapter,
          );
          if (!found) return fail("Chapter not found.", 404);
          return new Response(found.content, {
            headers: {
              ...NO_STORE,
              "content-type": "text/plain; charset=utf-8",
              "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
                safeFilename(found.title || `chapter-${chapter}`),
              )}.txt`,
            },
          });
        }

        const book = await exportNovelText({ env: context.env, db }, novelId);
        if (!book) return fail("Novel not found.", 404);
        return new Response(book.content, {
          headers: {
            ...NO_STORE,
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
              safeFilename(book.title),
            )}.txt`,
          },
        });
      },
    },
  },
});
