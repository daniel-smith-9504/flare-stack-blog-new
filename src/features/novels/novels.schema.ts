import { z } from "zod";
import {
  NOVEL_FONT_FAMILIES,
  NOVEL_READER_THEMES,
  NOVEL_SOURCES,
  NOVEL_STATUSES,
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
  NOVEL_QUOTE_MAX_LENGTH,
} from "@/features/novels/novels.constants";

export const NovelStatusSchema = z.enum(NOVEL_STATUSES);
export const NovelSourceSchema = z.enum(NOVEL_SOURCES);
export const NovelReaderThemeSchema = z.enum(NOVEL_READER_THEMES);
export const NovelFontFamilySchema = z.enum(NOVEL_FONT_FAMILIES);

// ==================== what readers get ====================

export const NovelSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
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
  createdAt: coercedDate,
});

export const PublicNotesInputSchema = z.strictObject({
  novelId: PathIdSchema,
  chapterOrder: z.number().int().min(1),
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
  })
  .describe("The fields to save; at least one.");

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

export type NovelSummary = z.infer<typeof NovelSummarySchema>;
export type NovelDetail = z.infer<typeof NovelDetailSchema>;
export type NovelChapterContent = z.infer<typeof NovelChapterSchema>;
export type PublicNote = z.infer<typeof PublicNoteSchema>;
export type OwnNote = z.infer<typeof OwnNoteSchema>;
export type NovelSettings = z.infer<typeof NovelSettingsSchema>;
export type AdminNovel = z.infer<typeof AdminNovelSchema>;
export type GutenbergBook = z.infer<typeof GutenbergBookSchema>;
export type SaveSettingsInput = z.infer<typeof SaveSettingsInputSchema>;
