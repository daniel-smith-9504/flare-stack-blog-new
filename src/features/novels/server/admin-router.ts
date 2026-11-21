import { z } from "zod";
import {
  AdminNovelListSchema,
  DeleteNovelInputSchema,
  GutenbergImportInputSchema,
  GutenbergSearchInputSchema,
  GutenbergSearchSchema,
  ImportAcceptedSchema,
  RetryImportInputSchema,
  UpdateNovelInputSchema,
} from "@/features/novels/novels.schema";
import * as NovelService from "@/features/novels/services/novels.service";
import { adminProcedure } from "@/lib/orpc/procedure";

const notFoundErrors = {
  NOVEL_NOT_FOUND: { status: 404, message: "Novel not found." },
} as const;

const list = adminProcedure
  .route({
    method: "GET",
    path: "/admin/novels",
    summary: "List every novel",
    description:
      "Every book on the shelf, newest first, with its import status and the reason of a failed import.",
    tags: ["Admin Novels"],
  })
  .output(AdminNovelListSchema)
  .handler(({ context }) => NovelService.listAdminNovels(context));

const update = adminProcedure
  .errors(notFoundErrors)
  .route({
    method: "PATCH",
    path: "/admin/novels/{id}",
    summary: "Edit a novel's details",
    description: "Changes the title, author, description, category or cover.",
    tags: ["Admin Novels"],
  })
  .input(UpdateNovelInputSchema)
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const changed = await NovelService.updateNovelAdmin(context, input);
    if (!changed) throw errors.NOVEL_NOT_FOUND();
    return { success: true };
  });

const remove = adminProcedure
  .errors(notFoundErrors)
  .route({
    method: "DELETE",
    path: "/admin/novels/{id}",
    summary: "Delete a novel",
    description:
      "Deletes the book, its chapters and their text. Readers' highlights of it go too.",
    tags: ["Admin Novels"],
  })
  .input(DeleteNovelInputSchema)
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const deleted = await NovelService.deleteNovelAdmin(context, input.id);
    if (!deleted) throw errors.NOVEL_NOT_FOUND();
    return { success: true };
  });

const retry = adminProcedure
  .errors({
    IMPORT_SOURCE_MISSING: {
      status: 400,
      message: "The uploaded file is gone; upload the book again.",
    },
  })
  .route({
    method: "POST",
    path: "/admin/novels/{id}/retry",
    summary: "Import a novel again",
    description:
      "Queues the same uploaded file again, which replaces its chapters.",
    tags: ["Admin Novels"],
  })
  .input(RetryImportInputSchema)
  .output(ImportAcceptedSchema)
  .handler(async ({ context, input, errors }) => {
    const accepted = await NovelService.retryImportAdmin(context, input.id);
    if (!accepted) throw errors.IMPORT_SOURCE_MISSING();
    return accepted;
  });

const gutenbergSearch = adminProcedure
  .errors({
    GUTENDEX_FAILED: {
      status: 502,
      message: "The Gutenberg catalogue did not answer.",
    },
  })
  .route({
    method: "GET",
    path: "/admin/novels/gutenberg",
    summary: "Search Project Gutenberg",
    description:
      "Searches free public-domain books on gutendex.com; at most 12 results.",
    tags: ["Admin Novels"],
  })
  .input(GutenbergSearchInputSchema)
  .output(GutenbergSearchSchema)
  .handler(async ({ input, errors }) => {
    try {
      return await NovelService.searchGutenbergBooks(input.query);
    } catch {
      throw errors.GUTENDEX_FAILED();
    }
  });

const gutenbergImport = adminProcedure
  .errors({
    GUTENDEX_FAILED: {
      status: 502,
      message: "Gutenberg's EPUB could not be downloaded.",
    },
  })
  .route({
    method: "POST",
    path: "/admin/novels/gutenberg",
    summary: "Import a Gutenberg book",
    description:
      "Downloads the free EPUB and queues it for import, like an upload.",
    tags: ["Admin Novels"],
  })
  .input(GutenbergImportInputSchema)
  .output(ImportAcceptedSchema)
  .handler(async ({ context, input, errors }) => {
    try {
      return await NovelService.importGutenbergAdmin(context, input.id);
    } catch (error) {
      throw errors.GUTENDEX_FAILED({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

export default {
  list,
  update,
  remove,
  retry,
  gutenbergSearch,
  gutenbergImport,
};
