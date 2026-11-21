import { createFileRoute } from "@tanstack/react-router";
import { insertNovel } from "@/features/novels/data/novels.data";
import { putImportFile } from "@/features/novels/data/novels.storage";
import { NOVEL_IMPORT_MAX_BYTES } from "@/features/novels/novels.constants";
import { getDb } from "@/lib/db";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

/** The book's name without its file extension, as the shelf shows it first. */
function titleOf(filename: string) {
  const base = filename.split(/[\\/]/u).pop() ?? filename;
  const withoutExtension = base.replace(/\.(?:epub|txt)$/iu, "");
  return (withoutExtension.trim() || "Untitled").slice(0, 300);
}

/**
 * Raw upload for a novel: the request body is the file itself, streamed into
 * R2 rather than buffered through the oRPC handler. Only an Admin's browser
 * session may call it.
 */
export const Route = createFileRoute("/novel-files")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const db = getDb(context.env);
        // Loaded lazily: `cloudflare:workers` only resolves inside workerd, and
        // the route tree is imported by node-run tests too.
        const { getRequestAuth } = await import("@/lib/auth/auth.server");
        const session = await getRequestAuth({
          db,
          env: context.env,
          executionCtx: context.executionCtx,
        })
          .api.getSession({ headers: request.headers })
          .catch(() => null);
        if (session?.user.role !== "admin")
          return fail("Only an Admin may upload a novel.", 403);

        const url = new URL(request.url);
        const filename = url.searchParams.get("filename") ?? "";
        const format = url.searchParams.get("format");
        if (format !== "epub" && format !== "txt")
          return fail("format must be epub or txt.", 400);
        if (!filename.toLowerCase().endsWith(`.${format}`))
          return fail("The file name does not match the format.", 400);

        const length = Number(request.headers.get("content-length"));
        if (!Number.isFinite(length) || length <= 0)
          return fail("A Content-Length is required.", 411);
        if (length > NOVEL_IMPORT_MAX_BYTES)
          return fail("The file is larger than 30 MB.", 413);
        if (!request.body) return fail("The request has no body.", 400);

        const fileKey = `novels/imports/${crypto.randomUUID()}.${format}`;
        await putImportFile(
          context.env,
          fileKey,
          request.body,
          format === "epub" ? "application/epub+zip" : "text/plain",
        );

        const novelId = await insertNovel(db, {
          title: titleOf(filename),
          fileKey,
          fileFormat: format,
          source: "upload",
        });
        await context.env.QUEUE.send({
          type: "NOVEL_IMPORT",
          data: { novelId, fileKey, format },
        });

        return Response.json(
          { id: novelId, status: "pending" },
          { status: 202, headers: NO_STORE },
        );
      },
    },
  },
});
