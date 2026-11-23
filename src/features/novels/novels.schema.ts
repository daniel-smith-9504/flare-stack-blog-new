import { z } from "zod";
import {
  NOVEL_FONT_FAMILIES,
  NOVEL_NOTE_STATUSES,
  NOVEL_READER_THEMES,
  NOVEL_READING_MODES,
  NOVEL_SOURCES,
  NOVEL_STATUSES,
  NOVEL_VOTE_CHOICES,
} from "@/lib/enum-values";
import { MAX_PAGE_NUMBER } from "@/lib/constants";
import { coercedDate } from "@/lib/orpc/dates";
import { PathIdSchema } from "@/lib/orpc/path-ids";
import {
  NOVEL_FONT_SIZE_MAX,
  NOVEL_FONT_SIZE_MIN,
  NOVEL_LINE_HEIGHT_MAX,
  NOVEL_LINE_HEIGHT_MIN,
  NOVEL_NOTE_MAX_LENGTH,
  NOVEL_PAGE_WIDTH_MAX,
  NOVEL_PAGE_WIDTH_MIN,
  NOVEL_QUOTE_MAX_LENGTH,
} from "@/features/novels/novels.constants";

export const NovelStatusSchema = z.enum(NOVEL_STATUSES);
export const NovelSourceSchema = z.enum(NOVEL_SOURCES);
export const NovelReaderThemeSchema = z.enum(NOVEL_READER_THEMES);
export const NovelFontFamilySchema = z.enum(NOVEL_FONT_FAMILIES);
export const NovelReadingModeSchema = z.enum(NOVEL_READING_MODES);
export const NovelNoteStatusSchema = z.enum(NOVEL_NOTE_STATUSES);
export const NovelVoteChoiceSchema = z.enum(NOVEL_VOTE_CHOICES);

// ==================== what readers get ====================

export const NovelSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  slug: z.string(),
  author: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  coverUrl: z.string().nullable(),
  language: z.string().nullable(),
  chapterCount: z.number().int(),
  wordCount: z.number().int(),
  updatedAt: coercedDate,
});

export const NovelChapterSummarySchema = z.object({
  order: z.number().int(),
  title: z.string(),
  wordCount: z.number().int(),
});

export const NovelProgressSchema = z.object({
  chapterOrder: z.number().int(),
  progressRatio: z.number(),
  updatedAt: coercedDate,
});

export const NovelDetailSchema = NovelSummarySchema.extend({
  chapters: z.array(NovelChapterSummarySchema),
});

export const NovelProgressInputSchema = z.strictObject({
  novelId: PathIdSchema,
});

export const NovelListInputSchema = z.object({
  page: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_NUMBER)
    .default(1)
    .describe("The page, from 1. A page past the last answers the last page."),
});

export const NovelListResponseSchema = z.object({
  items: z.array(NovelSummarySchema),
  page: z.number().int().positive(),
  totalPages: z.number().int().positive(),
});

export const NovelIdInputSchema = z.strictObject({ id: PathIdSchema });

export const NovelSlugInputSchema = z
  .strictObject({
    slug: z.string().min(1).max(200),
  })
  .describe("The readable part of a book's URL, or a legacy numeric id.");

export const NovelChapterInputSchema = z.strictObject({
  novelId: PathIdSchema,
  order: z.number().int().min(1),
});

export const NovelChapterSchema = z.object({
  novelId: z.number().int(),
  novelTitle: z.string(),
  order: z.number().int(),
  title: z.string(),
  content: z.string(),
  chapterCount: z.number().int(),
  prevOrder: z.number().int().nullable(),
  nextOrder: z.number().int().nullable(),
});

export const PublicNoteSchema = z.object({
  id: z.number().int(),
  chapterOrder: z.number().int(),
  quote: z.string(),
  note: z.string(),
  userName: z.string(),
  userImage: z.string().nullable(),
  likeCount: z.number().int(),
  likedByMe: z.boolean(),
  reportCount: z.number().int(),
  createdAt: coercedDate,
});

export const PublicNotesInputSchema = z.strictObject({
  novelId: PathIdSchema,
  chapterOrder: z.number().int().min(1),
  sort: z.enum(["newest", "hottest"]).default("newest"),
});

export const PublicNotesSchema = z.array(PublicNoteSchema);

// ==================== a signed-in reader's own data ====================

export const OwnNoteSchema = z.object({
  id: z.number().int(),
  chapterOrder: z.number().int(),
  startOffset: z.number().int(),
  endOffset: z.number().int(),
  quote: z.string(),
  note: z.string(),
  isPublic: z.boolean(),
  createdAt: coercedDate,
  updatedAt: coercedDate,
});

export const OwnNotesInputSchema = z.strictObject({
  novelId: PathIdSchema,
  chapterOrder: z.number().int().min(1),
});

export const OwnNotesSchema = z.array(OwnNoteSchema);

export const CreateNoteInputSchema = z.strictObject({
  novelId: PathIdSchema,
  chapterOrder: z.number().int().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  quote: z.string().min(1).max(NOVEL_QUOTE_MAX_LENGTH),
  contextBefore: z.string().max(200).default(""),
  contextAfter: z.string().max(200).default(""),
  note: z.string().max(NOVEL_NOTE_MAX_LENGTH).default(""),
  isPublic: z.boolean().default(false),
});

export const UpdateNoteInputSchema = z.strictObject({
  id: PathIdSchema,
  note: z.string().max(NOVEL_NOTE_MAX_LENGTH).optional(),
  isPublic: z.boolean().optional(),
});

export const DeleteNoteInputSchema = z.strictObject({ id: PathIdSchema });

export const SaveProgressInputSchema = z.strictObject({
  novelId: PathIdSchema,
  chapterOrder: z.number().int().min(1),
  progressRatio: z.number().min(0).max(1),
});

export const NovelSettingsSchema = z.object({
  theme: NovelReaderThemeSchema,
  fontSize: z.number().int(),
  lineHeight: z.number(),
  fontFamily: NovelFontFamilySchema,
  pageWidth: z.number().int(),
  readingMode: NovelReadingModeSchema,
});

export const SaveSettingsInputSchema = z
  .strictObject({
    theme: NovelReaderThemeSchema.optional(),
    fontSize: z
      .number()
      .int()
      .min(NOVEL_FONT_SIZE_MIN)
      .max(NOVEL_FONT_SIZE_MAX)
      .optional(),
    lineHeight: z
      .number()
      .min(NOVEL_LINE_HEIGHT_MIN)
      .max(NOVEL_LINE_HEIGHT_MAX)
      .optional(),
    fontFamily: NovelFontFamilySchema.optional(),
    pageWidth: z
      .number()
      .int()
      .min(NOVEL_PAGE_WIDTH_MIN)
      .max(NOVEL_PAGE_WIDTH_MAX)
      .optional(),
    readingMode: NovelReadingModeSchema.optional(),
  })
  .describe("The fields to save; at least one.");

// ==================== bookmarks and reading time ====================

export const NovelBookmarkSchema = z.object({
  id: z.number().int(),
  chapterOrder: z.number().int(),
  chapterTitle: z.string(),
  createdAt: coercedDate,
});

export const NovelBookmarksSchema = z.array(NovelBookmarkSchema);

export const NovelBookmarksInputSchema = z.strictObject({
  novelId: PathIdSchema,
});

export const SetBookmarkInputSchema = z.strictObject({
  novelId: PathIdSchema,
  chapterOrder: z.number().int().min(1),
  bookmarked: z.boolean(),
});

export const SetBookmarkOutputSchema = z.object({
  bookmarked: z.boolean(),
});

export const ReadingHeartbeatInputSchema = z.strictObject({
  novelId: PathIdSchema,
  chapterOrder: z.number().int().min(1),
  seconds: z.number().int().min(1).max(120),
  words: z.number().int().min(0).max(200_000),
});

// ==================== the social layer on shared highlights ====================

export const LikeNoteInputSchema = z.strictObject({ id: PathIdSchema });

export const LikeNoteOutputSchema = z.object({
  liked: z.boolean(),
  likeCount: z.number().int(),
});

export const ReportNoteInputSchema = z.strictObject({
  id: PathIdSchema,
  reason: z.string().max(500).default(""),
});

export const ReportNoteOutputSchema = z.object({
  reported: z.boolean(),
  reportCount: z.number().int(),
});

export const VoteNoteInputSchema = z.strictObject({
  id: PathIdSchema,
  choice: NovelVoteChoiceSchema,
});

export const VoteNoteOutputSchema = z.object({
  choice: NovelVoteChoiceSchema.nullable(),
  removeVotes: z.number().int(),
  keepVotes: z.number().int(),
});

export const AdminNoteSchema = z.object({
  id: z.number().int(),
  novelId: z.number().int(),
  novelTitle: z.string(),
  chapterOrder: z.number().int(),
  quote: z.string(),
  note: z.string(),
  userName: z.string(),
  userImage: z.string().nullable(),
  status: NovelNoteStatusSchema,
  reportCount: z.number().int(),
  likes: z.number().int(),
  removeVotes: z.number().int(),
  keepVotes: z.number().int(),
  removeReason: z.string().nullable(),
  createdAt: coercedDate,
});

export const AdminNoteListSchema = z.array(AdminNoteSchema);

export const AdminNoteListInputSchema = z.strictObject({
  status: NovelNoteStatusSchema.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export const ModerateNoteInputSchema = z.strictObject({
  id: PathIdSchema,
  reason: z.string().max(500).default(""),
});

export const ModerateNoteOutputSchema = z.object({
  status: NovelNoteStatusSchema,
});

/** The signed-in reader's own mute, if a novel or account mute is active. */
export const MyNovelMuteSchema = z.object({
  muted: z.boolean(),
  permanent: z.boolean(),
  until: coercedDate.nullable(),
  source: z.enum(["novel", "account"]).nullable(),
});

export const AdminNovelMuteSchema = z.object({
  id: z.number().int(),
  userId: z.string(),
  userName: z.string(),
  userImage: z.string().nullable(),
  level: z.number().int(),
  until: coercedDate.nullable(),
  reason: z.string(),
  createdAt: coercedDate,
  active: z.boolean(),
});

export const AdminNovelMuteListSchema = z.array(AdminNovelMuteSchema);

export const UnmuteNovelUserInputSchema = z.strictObject({
  id: PathIdSchema,
});

// ==================== the Admin's view ====================

export const AdminNovelSchema = NovelSummarySchema.extend({
  status: NovelStatusSchema,
  source: NovelSourceSchema,
  sourceId: z.string().nullable(),
  error: z.string().nullable(),
  fileFormat: z.enum(["epub", "txt"]).nullable(),
  createdAt: coercedDate,
});

export const AdminNovelListSchema = z.array(AdminNovelSchema);

export const UpdateNovelInputSchema = z.strictObject({
  id: PathIdSchema,
  title: z.string().min(1).max(300).optional(),
  author: z.string().max(300).optional(),
  description: z.string().max(20000).optional(),
  category: z.string().max(100).nullable().optional(),
  coverUrl: z.string().max(4096).nullable().optional(),
});

export const DeleteNovelInputSchema = z.strictObject({ id: PathIdSchema });

export const RetryImportInputSchema = z.strictObject({ id: PathIdSchema });

export const GutenbergSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(200),
});

export const GutenbergBookSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  author: z.string(),
  languages: z.array(z.string()),
  coverUrl: z.string().nullable(),
  downloadCount: z.number().int(),
});

export const GutenbergSearchSchema = z.array(GutenbergBookSchema);

export const GutenbergImportInputSchema = z.strictObject({
  id: z.number().int().min(1),
});

export const ImportAcceptedSchema = z.object({
  id: z.number().int(),
  status: NovelStatusSchema,
});

// ==================== the Admin's chapters ====================

export const AdminChapterSchema = z.object({
  novelId: z.number().int(),
  order: z.number().int(),
  title: z.string(),
  wordCount: z.number().int(),
  version: z.number().int(),
});

export const AdminChapterListInputSchema = z.strictObject({
  novelId: PathIdSchema,
});

export const AdminChapterListSchema = z.array(AdminChapterSchema);

export const AdminChapterInputSchema = z.strictObject({
  novelId: PathIdSchema,
  order: z.number().int().min(1),
});

export const AdminChapterContentSchema = AdminChapterSchema.extend({
  content: z.string(),
});

export const CreateChapterInputSchema = z.strictObject({
  novelId: PathIdSchema,
  title: z.string().max(300).default(""),
  content: z.string().min(1).max(2_000_000),
  /** Appended at the end when omitted. */
  order: z.number().int().min(1).optional(),
});

export const UpdateChapterInputSchema = z.strictObject({
  novelId: PathIdSchema,
  order: z.number().int().min(1),
  title: z.string().max(300).default(""),
  content: z.string().min(1).max(2_000_000),
  /** The version the editor loaded; a mismatch is a conflict. */
  version: z.number().int().min(0),
});

export const DeleteChapterInputSchema = z.strictObject({
  novelId: PathIdSchema,
  order: z.number().int().min(1),
});

export const MoveChapterInputSchema = z.strictObject({
  novelId: PathIdSchema,
  from: z.number().int().min(1),
  to: z.number().int().min(1),
});

export const BatchDeleteChaptersInputSchema = z.strictObject({
  novelId: PathIdSchema,
  orders: z.array(z.number().int().min(1)).min(1).max(200),
});

export const AdminChapterOutputSchema = z.object({ success: z.boolean() });

// ==================== the Admin's reading report ====================

export const AdminNovelStatsInputSchema = z.strictObject({
  days: z.number().int().min(1).max(365).default(30),
});

export const AdminNovelStatsSchema = z.object({
  days: z.number().int(),
  summary: z.object({
    views: z.number().int(),
    visitors: z.number().int(),
    seconds: z.number().int(),
    words: z.number().int(),
  }),
  daily: z.array(
    z.object({
      day: z.number().int(),
      views: z.number().int(),
      seconds: z.number().int(),
    }),
  ),
  topNovels: z.array(
    z.object({
      id: z.number().int(),
      title: z.string(),
      views: z.number().int(),
      seconds: z.number().int(),
    }),
  ),
  topChapters: z.array(
    z.object({
      novelId: z.number().int(),
      novelTitle: z.string(),
      chapterOrder: z.number().int(),
      views: z.number().int(),
    }),
  ),
});

export type NovelSummary = z.infer<typeof NovelSummarySchema>;
export type NovelDetail = z.infer<typeof NovelDetailSchema>;
export type NovelChapterContent = z.infer<typeof NovelChapterSchema>;
export type PublicNote = z.infer<typeof PublicNoteSchema>;
export type OwnNote = z.infer<typeof OwnNoteSchema>;
export type NovelSettings = z.infer<typeof NovelSettingsSchema>;
export type NovelBookmark = z.infer<typeof NovelBookmarkSchema>;
export type AdminNovel = z.infer<typeof AdminNovelSchema>;
export type AdminChapter = z.infer<typeof AdminChapterSchema>;
export type AdminChapterContent = z.infer<typeof AdminChapterContentSchema>;
export type AdminNote = z.infer<typeof AdminNoteSchema>;
export type MyNovelMute = z.infer<typeof MyNovelMuteSchema>;
export type AdminNovelMute = z.infer<typeof AdminNovelMuteSchema>;
export type AdminNovelStats = z.infer<typeof AdminNovelStatsSchema>;
export type GutenbergBook = z.infer<typeof GutenbergBookSchema>;
export type SaveSettingsInput = z.infer<typeof SaveSettingsInputSchema>;
