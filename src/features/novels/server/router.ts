import { lazy } from "@orpc/server";
import { z } from "zod";
import {
  CreateNoteInputSchema,
  DeleteNoteInputSchema,
  NovelChapterInputSchema,
  NovelChapterSchema,
  NovelDetailSchema,
  NovelIdInputSchema,
  NovelListInputSchema,
  NovelListResponseSchema,
  NovelProgressInputSchema,
  NovelProgressSchema,
  NovelSettingsSchema,
  OwnNoteSchema,
  OwnNotesInputSchema,
  OwnNotesSchema,
  PublicNotesInputSchema,
  PublicNotesSchema,
  SaveProgressInputSchema,
  SaveSettingsInputSchema,
  UpdateNoteInputSchema,
} from "@/features/novels/novels.schema";
import { DEFAULT_NOVEL_SETTINGS } from "@/features/novels/novels.constants";
import * as NovelService from "@/features/novels/services/novels.service";
import { authProcedure, publicProcedure } from "@/lib/orpc/procedure";
import { unwrapResult } from "@/lib/orpc/unwrap-result";

const novelNotFoundErrors = {
  NOVEL_NOT_FOUND: { status: 404, message: "Novel not found." },
} as const;

const chapterNotFoundErrors = {
  CHAPTER_NOT_FOUND: { status: 404, message: "Chapter not found." },
} as const;

const list = publicProcedure
  .route({
    method: "GET",
    path: "/novels",
    summary: "List novels",
    description:
      "Lists books ready to read, newest first, a page at a time. A page past the last answers the last page.",
    tags: ["Novels"],
  })
  .input(NovelListInputSchema)
  .output(NovelListResponseSchema)
  .handler(({ context, input }) =>
    NovelService.getNovelsPage(context, input.page),
  );

const byId = publicProcedure
  .errors(novelNotFoundErrors)
  .route({
    method: "GET",
    path: "/novels/{id}",
    summary: "Get a novel with its table of contents",
    description: "The book and its chapters in reading order.",
    tags: ["Novels"],
  })
  .input(NovelIdInputSchema)
  .output(NovelDetailSchema)
  .handler(async ({ context, input, errors }) => {
    const novel = await NovelService.getNovelDetail(context, input.id);
    if (!novel) throw errors.NOVEL_NOT_FOUND();
    return novel;
  });

const progress = authProcedure
  .route({
    method: "GET",
    path: "/novels/progress",
    summary: "Get your place in a novel",
    description:
      "The chapter and how far down it the signed-in reader stopped, or null.",
    tags: ["Novels"],
  })
  .input(NovelProgressInputSchema)
  .output(NovelProgressSchema.nullable())
  .handler(({ context, input }) =>
    NovelService.getProgress(context, input.novelId),
  );

const chapter = publicProcedure
  .errors({
    ...novelNotFoundErrors,
    ...chapterNotFoundErrors,
  })
  .route({
    method: "GET",
    path: "/novels/{novelId}/chapters/{order}",
    summary: "Read one chapter",
    description: "The chapter's plain text and the chapters before and after.",
    tags: ["Novels"],
  })
  .input(NovelChapterInputSchema)
  .output(NovelChapterSchema)
  .handler(async ({ context, input, errors }) => {
    const chapterView = await NovelService.getChapter(
      context,
      input.novelId,
      input.order,
    );
    if (!chapterView) throw errors.CHAPTER_NOT_FOUND();
    return chapterView;
  });

const publicNotes = publicProcedure
  .route({
    method: "GET",
    path: "/novels/{novelId}/notes/public",
    summary: "List a chapter's shared highlights",
    description:
      "Highlights readers chose to share, oldest first, with the name of each reader.",
    tags: ["Novels"],
  })
  .input(PublicNotesInputSchema)
  .output(PublicNotesSchema)
  .handler(({ context, input }) =>
    NovelService.getPublicNotes(context, input.novelId, input.chapterOrder),
  );

const myNotes = authProcedure
  .route({
    method: "GET",
    path: "/novels/notes",
    summary: "List your highlights in a chapter",
    description:
      "The signed-in reader's highlights in one chapter, in reading order.",
    tags: ["Novels"],
  })
  .input(OwnNotesInputSchema)
  .output(OwnNotesSchema)
  .handler(({ context, input }) =>
    NovelService.getOwnNotes(context, input.novelId, input.chapterOrder),
  );

const createNote = authProcedure
  .errors({
    ...chapterNotFoundErrors,
    NOTE_OFFSET_INVALID: {
      status: 400,
      message: "The highlighted text does not match the chapter.",
    },
  })
  .route({
    method: "POST",
    path: "/novels/notes",
    summary: "Highlight text",
    description:
      "Stores a highlight and its note. Readers may share it; a shared highlight shows on the chapter's public list.",
    tags: ["Novels"],
  })
  .input(CreateNoteInputSchema)
  .output(OwnNoteSchema)
  .handler(({ context, input, errors }) =>
    unwrapResult(NovelService.createNote(context, input), {
      CHAPTER_NOT_FOUND: () => {
        throw errors.CHAPTER_NOT_FOUND();
      },
      NOTE_OFFSET_INVALID: () => {
        throw errors.NOTE_OFFSET_INVALID();
      },
    }),
  );

const updateNote = authProcedure
  .errors({
    NOTE_NOT_FOUND: { status: 404, message: "Highlight not found." },
  })
  .route({
    method: "PATCH",
    path: "/novels/notes/{id}",
    summary: "Edit a highlight",
    description: "Changes your note or whether the highlight is shared.",
    tags: ["Novels"],
  })
  .input(UpdateNoteInputSchema)
  .output(OwnNoteSchema)
  .handler(async ({ context, input, errors }) => {
    const note = await NovelService.updateNote(context, input);
    if (!note) throw errors.NOTE_NOT_FOUND();
    return note;
  });

const deleteNote = authProcedure
  .errors({
    NOTE_NOT_FOUND: { status: 404, message: "Highlight not found." },
  })
  .route({
    method: "DELETE",
    path: "/novels/notes/{id}",
    summary: "Delete a highlight",
    description: "Deletes one of your highlights.",
    tags: ["Novels"],
  })
  .input(DeleteNoteInputSchema)
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const deleted = await NovelService.deleteNote(context, input.id);
    if (!deleted) throw errors.NOTE_NOT_FOUND();
    return { success: true };
  });

const saveProgress = authProcedure
  .errors(chapterNotFoundErrors)
  .route({
    method: "PUT",
    path: "/novels/progress",
    summary: "Save your place",
    description:
      "Records the chapter and how far down it the signed-in reader is.",
    tags: ["Novels"],
  })
  .input(SaveProgressInputSchema)
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const saved = await NovelService.saveProgress(context, input);
    if (!saved) throw errors.CHAPTER_NOT_FOUND();
    return { success: true };
  });

const settings = authProcedure
  .route({
    method: "GET",
    path: "/novels/settings",
    summary: "Get your reading settings",
    description: "The signed-in reader's font, line height and theme.",
    tags: ["Novels"],
  })
  .output(NovelSettingsSchema)
  .handler(({ context }) => NovelService.getSettings(context));

const saveSettings = authProcedure
  .errors({
    NOVEL_SETTINGS_EMPTY: {
      status: 400,
      message: "At least one setting is needed.",
    },
  })
  .route({
    method: "PUT",
    path: "/novels/settings",
    summary: "Save your reading settings",
    description: "Changes the fields stated and keeps the others.",
    tags: ["Novels"],
  })
  .input(SaveSettingsInputSchema)
  .output(NovelSettingsSchema)
  .handler(async ({ context, input, errors }) => {
    if (Object.keys(input).length === 0) throw errors.NOVEL_SETTINGS_EMPTY();
    const saved = await NovelService.saveSettings(context, input);
    return saved ?? DEFAULT_NOVEL_SETTINGS;
  });

export default {
  list,
  byId,
  progress,
  chapter,
  publicNotes,
  myNotes,
  createNote,
  updateNote,
  deleteNote,
  saveProgress,
  settings,
  saveSettings,
  admin: lazy(() => import("./admin-router"), { prefix: "/admin/novels" }),
};
