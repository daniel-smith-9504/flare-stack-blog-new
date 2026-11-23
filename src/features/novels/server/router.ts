import { lazy } from "@orpc/server";
import { z } from "zod";
import {
  CreateNoteInputSchema,
  DeleteNoteInputSchema,
  LikeNoteInputSchema,
  LikeNoteOutputSchema,
  NovelBookmarksInputSchema,
  NovelBookmarksSchema,
  NovelChapterInputSchema,
  NovelChapterSchema,
  NovelDetailSchema,
  NovelIdInputSchema,
  NovelListInputSchema,
  NovelListResponseSchema,
  NovelProgressInputSchema,
  NovelProgressSchema,
  NovelSettingsSchema,
  NovelTagListSchema,
  MyNovelMuteSchema,
  OwnNoteSchema,
  OwnNotesInputSchema,
  OwnNotesSchema,
  PublicNotesInputSchema,
  PublicNotesSchema,
  ReadingHeartbeatInputSchema,
  ReportNoteInputSchema,
  ReportNoteOutputSchema,
  SaveProgressInputSchema,
  SaveSettingsInputSchema,
  SetBookmarkInputSchema,
  SetBookmarkOutputSchema,
  UpdateNoteInputSchema,
  VoteNoteInputSchema,
  VoteNoteOutputSchema,
} from "@/features/novels/novels.schema";
import { DEFAULT_NOVEL_SETTINGS } from "@/features/novels/novels.constants";
import * as NovelService from "@/features/novels/services/novels.service";
import {
  authProcedure,
  optionalSessionProcedure,
  publicProcedure,
} from "@/lib/orpc/procedure";
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
    NovelService.getNovelsPage(context, input.page, input.tag),
  );

const tags = publicProcedure
  .route({
    method: "GET",
    path: "/novels/tags",
    summary: "List shelf tags",
    description: "Every tag on the shelf, with how many books carry it.",
    tags: ["Novels"],
  })
  .output(NovelTagListSchema)
  .handler(({ context }) => NovelService.listShelfTags(context));

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

const publicNotes = optionalSessionProcedure
  .route({
    method: "GET",
    path: "/novels/{novelId}/notes/public",
    summary: "List a chapter's shared highlights",
    description:
      "Highlights readers chose to share, with the name of each reader, their likes and whether you liked them.",
    tags: ["Novels"],
  })
  .input(PublicNotesInputSchema)
  .output(PublicNotesSchema)
  .handler(({ context, input }) =>
    NovelService.getPublicNotes(context, {
      ...input,
      viewerId: context.session?.user.id,
    }),
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

const myMute = authProcedure
  .route({
    method: "GET",
    path: "/novels/mute",
    summary: "Read your mute status",
    description:
      "Whether an account or novel mute currently stops you from posting highlights, and until when.",
    tags: ["Novels"],
  })
  .output(MyNovelMuteSchema)
  .handler(({ context }) => NovelService.getMyMute(context));

const createNote = authProcedure
  .errors({
    ...chapterNotFoundErrors,
    NOTE_OFFSET_INVALID: {
      status: 400,
      message: "The highlighted text does not match the chapter.",
    },
    MUTED: {
      status: 403,
      message: "You cannot share highlights while muted.",
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
      MUTED: () => {
        throw errors.MUTED();
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

const bookmarks = authProcedure
  .route({
    method: "GET",
    path: "/novels/bookmarks",
    summary: "List your bookmarks in a novel",
    description: "The chapters you marked, newest first.",
    tags: ["Novels"],
  })
  .input(NovelBookmarksInputSchema)
  .output(NovelBookmarksSchema)
  .handler(({ context, input }) =>
    NovelService.getBookmarks(context, input.novelId),
  );

const setBookmark = authProcedure
  .errors(chapterNotFoundErrors)
  .route({
    method: "PUT",
    path: "/novels/bookmarks",
    summary: "Mark or unmark a chapter",
    description: "Adds or removes your bookmark on one chapter.",
    tags: ["Novels"],
  })
  .input(SetBookmarkInputSchema)
  .output(SetBookmarkOutputSchema)
  .handler(async ({ context, input, errors }) => {
    const result = await NovelService.setBookmark(context, input);
    if (!result) throw errors.CHAPTER_NOT_FOUND();
    return result;
  });

const reading = authProcedure
  .errors(chapterNotFoundErrors)
  .route({
    method: "POST",
    path: "/novels/reading",
    summary: "Record reading time",
    description:
      "Adds one heartbeat's seconds and read words to the day's total.",
    tags: ["Novels"],
  })
  .input(ReadingHeartbeatInputSchema)
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const recorded = await NovelService.recordReading(context, input);
    if (!recorded) throw errors.CHAPTER_NOT_FOUND();
    return { success: true };
  });

const likeNote = authProcedure
  .errors({
    NOTE_NOT_FOUND: { status: 404, message: "Highlight not found." },
    NOT_PUBLIC: { status: 400, message: "This highlight is not shared." },
  })
  .route({
    method: "POST",
    path: "/novels/notes/{id}/like",
    summary: "Like or unlike a shared highlight",
    description: "Toggles your like on one shared highlight.",
    tags: ["Novels"],
  })
  .input(LikeNoteInputSchema)
  .output(LikeNoteOutputSchema)
  .handler(({ context, input, errors }) =>
    unwrapResult(NovelService.toggleNoteLike(context, input.id), {
      NOTE_NOT_FOUND: () => {
        throw errors.NOTE_NOT_FOUND();
      },
      NOT_PUBLIC: () => {
        throw errors.NOT_PUBLIC();
      },
      ALREADY_REPORTED: () => {
        throw errors.NOT_PUBLIC();
      },
      TOO_FEW_REPORTS: () => {
        throw errors.NOT_PUBLIC();
      },
    }),
  );

/** A stable key for a guest, so one visitor cannot report a note twice. */
async function guestReporterKey(headers: Headers) {
  const ip =
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`novel-report:${ip}`),
  );
  return `ip:${Array.from(new Uint8Array(digest).slice(0, 8))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

const reportNote = optionalSessionProcedure
  .errors({
    NOTE_NOT_FOUND: { status: 404, message: "Highlight not found." },
    NOT_PUBLIC: { status: 400, message: "This highlight is not shared." },
  })
  .route({
    method: "POST",
    path: "/novels/notes/{id}/report",
    summary: "Report a shared highlight",
    description:
      "Anyone, signed in or not, may report a shared highlight once.",
    tags: ["Novels"],
  })
  .input(ReportNoteInputSchema)
  .output(ReportNoteOutputSchema)
  .handler(async ({ context, input, errors }) => {
    const userId = context.session?.user.id ?? null;
    return unwrapResult(
      NovelService.reportNote(context, {
        id: input.id,
        reason: input.reason,
        reporterId: userId,
        reporterKey: userId
          ? `user:${userId}`
          : await guestReporterKey(context.headers),
      }),
      {
        NOTE_NOT_FOUND: () => {
          throw errors.NOTE_NOT_FOUND();
        },
        NOT_PUBLIC: () => {
          throw errors.NOT_PUBLIC();
        },
        ALREADY_REPORTED: () => {
          throw errors.NOT_PUBLIC();
        },
        TOO_FEW_REPORTS: () => {
          throw errors.NOT_PUBLIC();
        },
      },
    );
  });

const voteNote = authProcedure
  .errors({
    NOTE_NOT_FOUND: { status: 404, message: "Highlight not found." },
    NOT_PUBLIC: { status: 400, message: "This highlight is not shared." },
    TOO_FEW_REPORTS: {
      status: 400,
      message: "This highlight does not have enough reports to vote on.",
    },
  })
  .route({
    method: "POST",
    path: "/novels/notes/{id}/vote",
    summary: "Vote on a reported highlight",
    description:
      "A shared highlight with enough reports goes to a community vote.",
    tags: ["Novels"],
  })
  .input(VoteNoteInputSchema)
  .output(VoteNoteOutputSchema)
  .handler(({ context, input, errors }) =>
    unwrapResult(NovelService.voteNote(context, input), {
      NOTE_NOT_FOUND: () => {
        throw errors.NOTE_NOT_FOUND();
      },
      NOT_PUBLIC: () => {
        throw errors.NOT_PUBLIC();
      },
      ALREADY_REPORTED: () => {
        throw errors.NOT_PUBLIC();
      },
      TOO_FEW_REPORTS: () => {
        throw errors.TOO_FEW_REPORTS();
      },
    }),
  );

export default {
  list,
  tags,
  byId,
  progress,
  chapter,
  publicNotes,
  myNotes,
  myMute,
  createNote,
  updateNote,
  deleteNote,
  saveProgress,
  settings,
  saveSettings,
  bookmarks,
  setBookmark,
  reading,
  likeNote,
  reportNote,
  voteNote,
  admin: lazy(() => import("./admin-router"), { prefix: "/admin/novels" }),
};
