import { z } from "zod";
import {
  AdminChapterContentSchema,
  AdminChapterInputSchema,
  AdminChapterListInputSchema,
  AdminChapterListSchema,
  AdminChapterOutputSchema,
  AdminChapterSchema,
  AdminNoteListInputSchema,
  AdminNoteListSchema,
  AdminNovelListSchema,
  AdminNovelMuteListSchema,
  AdminNovelStatsInputSchema,
  AdminNovelStatsSchema,
  BatchDeleteChaptersInputSchema,
  CreateChapterInputSchema,
  DeleteChapterInputSchema,
  DeleteNovelInputSchema,
  GutenbergImportInputSchema,
  GutenbergSearchInputSchema,
  GutenbergSearchSchema,
  ImportAcceptedSchema,
  ModerateNoteInputSchema,
  ModerateNoteOutputSchema,
  MoveChapterInputSchema,
  RetryImportInputSchema,
  UnmuteNovelUserInputSchema,
  UpdateChapterInputSchema,
  UpdateNovelInputSchema,
} from "@/features/novels/novels.schema";
import * as NovelService from "@/features/novels/services/novels.service";
import { PathIdSchema } from "@/lib/orpc/path-ids";
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

// ==================== chapters ====================

const chapters = adminProcedure
  .route({
    method: "GET",
    path: "/admin/novels/{novelId}/chapters",
    summary: "List a novel's chapters",
    description:
      "Every chapter in reading order, with its word count and version.",
    tags: ["Admin Novels"],
  })
  .input(AdminChapterListInputSchema)
  .output(AdminChapterListSchema)
  .handler(({ context, input }) =>
    NovelService.listAdminChapters(context, input.novelId),
  );

const chapter = adminProcedure
  .errors({
    ...notFoundErrors,
    CHAPTER_NOT_FOUND: { status: 404, message: "Chapter not found." },
  })
  .route({
    method: "GET",
    path: "/admin/novels/{novelId}/chapters/{order}",
    summary: "Read one chapter for editing",
    description: "The chapter's title, version and plain text.",
    tags: ["Admin Novels"],
  })
  .input(AdminChapterInputSchema)
  .output(AdminChapterContentSchema)
  .handler(async ({ context, input, errors }) => {
    const found = await NovelService.getAdminChapter(
      context,
      input.novelId,
      input.order,
    );
    if (!found) throw errors.CHAPTER_NOT_FOUND();
    return found;
  });

const createChapter = adminProcedure
  .errors(notFoundErrors)
  .route({
    method: "POST",
    path: "/admin/novels/{novelId}/chapters",
    summary: "Add a chapter",
    description:
      "Adds a chapter at the end, or at the stated order and shifts the rest down.",
    tags: ["Admin Novels"],
  })
  .input(CreateChapterInputSchema)
  .output(AdminChapterSchema)
  .handler(async ({ context, input, errors }) => {
    const created = await NovelService.createAdminChapter(context, input);
    if (!created) throw errors.NOVEL_NOT_FOUND();
    return created;
  });

const updateChapter = adminProcedure
  .errors({
    ...notFoundErrors,
    CHAPTER_NOT_FOUND: { status: 404, message: "Chapter not found." },
    CHAPTER_CONFLICT: {
      status: 409,
      message: "The chapter changed since you opened it.",
    },
  })
  .route({
    method: "PUT",
    path: "/admin/novels/{novelId}/chapters/{order}",
    summary: "Edit a chapter",
    description:
      "Replaces the chapter's text. The version guards against overwriting a concurrent edit.",
    tags: ["Admin Novels"],
  })
  .input(UpdateChapterInputSchema)
  .output(AdminChapterSchema)
  .handler(async ({ context, input, errors }) => {
    const result = await NovelService.updateAdminChapter(context, input);
    if (result.status === "missing") throw errors.CHAPTER_NOT_FOUND();
    if (result.status === "conflict") throw errors.CHAPTER_CONFLICT();
    return result.chapter;
  });

const deleteChapter = adminProcedure
  .route({
    method: "DELETE",
    path: "/admin/novels/{novelId}/chapters/{order}",
    summary: "Delete a chapter",
    description:
      "Deletes the chapter and its text, then renumbers the chapters after it.",
    tags: ["Admin Novels"],
  })
  .input(DeleteChapterInputSchema)
  .output(AdminChapterOutputSchema)
  .handler(async ({ context, input }) => {
    await NovelService.deleteAdminChapters(context, input.novelId, [
      input.order,
    ]);
    return { success: true };
  });

const batchDeleteChapters = adminProcedure
  .route({
    method: "POST",
    path: "/admin/novels/{novelId}/chapters/batch-delete",
    summary: "Delete several chapters",
    description: "Deletes the chosen chapters and renumbers the rest.",
    tags: ["Admin Novels"],
  })
  .input(BatchDeleteChaptersInputSchema)
  .output(AdminChapterOutputSchema)
  .handler(async ({ context, input }) => {
    await NovelService.deleteAdminChapters(
      context,
      input.novelId,
      input.orders,
    );
    return { success: true };
  });

const moveChapter = adminProcedure
  .errors({
    CHAPTER_NOT_FOUND: { status: 404, message: "Chapter not found." },
  })
  .route({
    method: "POST",
    path: "/admin/novels/{novelId}/chapters/move",
    summary: "Swap two chapters",
    description: "Exchanges two chapters' order and text.",
    tags: ["Admin Novels"],
  })
  .input(MoveChapterInputSchema)
  .output(AdminChapterOutputSchema)
  .handler(async ({ context, input, errors }) => {
    const moved = await NovelService.moveAdminChapter(
      context,
      input.novelId,
      input.from,
      input.to,
    );
    if (!moved) throw errors.CHAPTER_NOT_FOUND();
    return { success: true };
  });

// ==================== reading report and annotations ====================

const stats = adminProcedure
  .route({
    method: "GET",
    path: "/admin/novels/stats",
    summary: "Reading report",
    description:
      "Views, visitors, reading time and the most-read books and chapters in the window.",
    tags: ["Admin Novels"],
  })
  .input(AdminNovelStatsInputSchema)
  .output(AdminNovelStatsSchema)
  .handler(({ context, input }) =>
    NovelService.getNovelStats(context, input.days),
  );

const notes = adminProcedure
  .route({
    method: "GET",
    path: "/admin/novels/notes",
    summary: "List highlights for moderation",
    description:
      "Shared highlights with their reports, likes and community votes.",
    tags: ["Admin Novels"],
  })
  .input(AdminNoteListInputSchema)
  .output(AdminNoteListSchema)
  .handler(({ context, input }) => NovelService.listAdminNotes(context, input));

const removeNote = adminProcedure
  .errors({
    NOTE_NOT_FOUND: { status: 404, message: "Highlight not found." },
  })
  .route({
    method: "POST",
    path: "/admin/novels/notes/{id}/remove",
    summary: "Remove a shared highlight",
    description:
      "Hides the highlight, resolves its reports and mutes its author step by step.",
    tags: ["Admin Novels"],
  })
  .input(ModerateNoteInputSchema)
  .output(ModerateNoteOutputSchema)
  .handler(async ({ context, input, errors }) => {
    const status = await NovelService.removeAdminNote(
      context,
      input.id,
      input.reason,
    );
    if (!status) throw errors.NOTE_NOT_FOUND();
    return { status };
  });

const restoreNote = adminProcedure
  .errors({
    NOTE_NOT_FOUND: { status: 404, message: "Highlight not found." },
  })
  .route({
    method: "POST",
    path: "/admin/novels/notes/{id}/restore",
    summary: "Restore a removed highlight",
    description: "Shows the highlight publicly again.",
    tags: ["Admin Novels"],
  })
  .input(z.strictObject({ id: PathIdSchema }))
  .output(ModerateNoteOutputSchema)
  .handler(async ({ context, input, errors }) => {
    const status = await NovelService.restoreAdminNote(context, input.id);
    if (!status) throw errors.NOTE_NOT_FOUND();
    return { status };
  });

const mutes = adminProcedure
  .route({
    method: "GET",
    path: "/admin/novels/mutes",
    summary: "List reader mutes",
    description:
      "Every novel mute, newest first, with its level, end and the reason it was set.",
    tags: ["Admin Novels"],
  })
  .output(AdminNovelMuteListSchema)
  .handler(({ context }) => NovelService.listAdminMutes(context));

const unmute = adminProcedure
  .errors({
    MUTE_NOT_FOUND: { status: 404, message: "Mute not found." },
  })
  .route({
    method: "POST",
    path: "/admin/novels/mutes/{id}/unmute",
    summary: "Lift a reader's novel mute",
    description:
      "Ends the mute now; the recorded level still raises the next one.",
    tags: ["Admin Novels"],
  })
  .input(UnmuteNovelUserInputSchema)
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const result = await NovelService.unmuteNovelReader(context, input.id);
    if (!result) throw errors.MUTE_NOT_FOUND();
    return { success: true };
  });

export default {
  list,
  update,
  remove,
  retry,
  gutenbergSearch,
  gutenbergImport,
  chapters,
  chapter,
  createChapter,
  updateChapter,
  deleteChapter,
  batchDeleteChapters,
  moveChapter,
  stats,
  notes,
  removeNote,
  restoreNote,
  mutes,
  unmute,
};
