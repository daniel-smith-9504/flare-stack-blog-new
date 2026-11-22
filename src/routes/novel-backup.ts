import { createFileRoute } from "@tanstack/react-router";
import {
  exportNovelBackup,
  restoreNovelBackup,
  type NovelBackup,
} from "@/features/novels/services/novels.service";
import { getDb } from "@/lib/db";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function optionalText(value: unknown, limit: number) {
  return typeof value === "string" ? value.slice(0, limit) : null;
}

/** The backup is validated by hand to keep classic zod out of the app shell. */
function parseBackup(body: unknown): NovelBackup | null {
  if (typeof body !== "object" || body === null) return null;
  const backup = body as Record<string, unknown>;
  if (backup.version !== 1 || !Array.isArray(backup.novels)) return null;
  if (backup.novels.length > 500) return null;
  const novels: NovelBackup["novels"] = [];
  for (const raw of backup.novels) {
    if (typeof raw !== "object" || raw === null) return null;
    const book = raw as Record<string, unknown>;
    if (typeof book.title !== "string" || book.title.length === 0) return null;
    if (book.title.length > 300 || !Array.isArray(book.chapters)) return null;
    if (book.chapters.length > 5000) return null;
    const chapters: Array<{ title: string; content: string }> = [];
    for (const rawChapter of book.chapters) {
      if (typeof rawChapter !== "object" || rawChapter === null) return null;
      const chapter = rawChapter as Record<string, unknown>;
      if (typeof chapter.content !== "string") return null;
      if (chapter.content.length > 2_000_000) return null;
      chapters.push({
        title: text(chapter.title, 300),
        content: chapter.content,
      });
    }
    novels.push({
      title: book.title,
      author: text(book.author, 300),
      description: text(book.description, 20_000),
      category: optionalText(book.category, 120),
      coverUrl: optionalText(book.coverUrl, 2000),
      language: optionalText(book.language, 40),
      chapters,
    });
  }
  return {
    version: 1,
    exportedAt:
      typeof backup.exportedAt === "string"
        ? backup.exportedAt
        : new Date().toISOString(),
    novels,
  };
}

/** Backs up every novel to JSON, and restores such a backup. Admin only. */
export const Route = createFileRoute("/novel-backup")({
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
          return fail("Only an Admin may export a backup.", 403);

        const backup = await exportNovelBackup({ env: context.env, db });
        return new Response(JSON.stringify(backup), {
          headers: {
            ...NO_STORE,
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="novels-backup-${new Date()
              .toISOString()
              .slice(0, 10)}.json"`,
          },
        });
      },
      POST: async ({ request, context }) => {
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
          return fail("Only an Admin may restore a backup.", 403);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return fail("The body is not JSON.", 400);
        }
        const parsed = parseBackup(body);
        if (!parsed)
          return fail("The backup file is not in the expected shape.", 400);
        try {
          const restored = await restoreNovelBackup(
            { env: context.env, db },
            parsed,
          );
          return Response.json({ restored }, { headers: NO_STORE });
        } catch {
          return fail("The backup could not be restored.", 500);
        }
      },
    },
  },
});
