import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth.table";
import { createdAt, id, updatedAt } from "./helper";
import {
  NOVEL_FILE_FORMATS,
  NOVEL_FONT_FAMILIES,
  NOVEL_READER_THEMES,
  NOVEL_SOURCES,
  NOVEL_STATUSES,
} from "../../enum-values";

export {
  NOVEL_FILE_FORMATS,
  NOVEL_FONT_FAMILIES,
  NOVEL_READER_THEMES,
  NOVEL_SOURCES,
  NOVEL_STATUSES,
};

/**
 * A book on the shelf. Its chapter text is not here: each chapter is an R2
 * object (`novels/{id}/chapters/{order}.txt`), because a D1 row holds at most
 * 2 MB. `status` follows an import from pending to parsing to ready or failed.
 */
export const NovelsTable = sqliteTable(
  "novels",
  {
    id,
    title: text().notNull(),
    author: text().notNull().default(""),
    description: text().notNull().default(""),
    category: text(),
    coverUrl: text("cover_url"),
    source: text("source", { enum: NOVEL_SOURCES }).notNull().default("upload"),
    sourceId: text("source_id"),
    language: text(),
    status: text("status", { enum: NOVEL_STATUSES })
      .notNull()
      .default("pending"),
    /** Why the last import failed, for the Admin's list. */
    error: text(),
    /** The uploaded file in R2, kept only until the import finishes. */
    fileKey: text("file_key"),
    fileFormat: text("file_format", { enum: NOVEL_FILE_FORMATS }),
    chapterCount: integer("chapter_count").notNull().default(0),
    wordCount: integer("word_count").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("novels_updated_idx").on(table.updatedAt, table.id),
    index("novels_category_idx").on(table.category, table.updatedAt),
    index("novels_status_idx").on(table.status, table.updatedAt),
  ],
);

export const NovelChaptersTable = sqliteTable(
  "novel_chapters",
  {
    id,
    novelId: integer("novel_id")
      .notNull()
      .references(() => NovelsTable.id, { onDelete: "cascade" }),
    /** From 1, the order the book reads in. */
    chapterOrder: integer("chapter_order").notNull(),
    title: text().notNull().default(""),
    wordCount: integer("word_count").notNull().default(0),
    createdAt,
  },
  (table) => [
    uniqueIndex("novel_chapters_order_idx").on(
      table.novelId,
      table.chapterOrder,
    ),
  ],
);

export const NovelProgressTable = sqliteTable(
  "novel_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    novelId: integer("novel_id")
      .notNull()
      .references(() => NovelsTable.id, { onDelete: "cascade" }),
    chapterOrder: integer("chapter_order").notNull().default(1),
    /** How far down the chapter the reader was, from 0 to 1. */
    progressRatio: real("progress_ratio").notNull().default(0),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.novelId] }),
    index("novel_progress_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const NovelNotesTable = sqliteTable(
  "novel_notes",
  {
    id,
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    novelId: integer("novel_id")
      .notNull()
      .references(() => NovelsTable.id, { onDelete: "cascade" }),
    chapterOrder: integer("chapter_order").notNull(),
    /** Character offsets into the chapter's plain text. */
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    quote: text().notNull(),
    contextBefore: text("context_before").notNull().default(""),
    contextAfter: text("context_after").notNull().default(""),
    note: text().notNull().default(""),
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("novel_notes_chapter_idx").on(
      table.novelId,
      table.chapterOrder,
      table.startOffset,
    ),
    index("novel_notes_user_idx").on(table.userId, table.updatedAt),
    index("novel_notes_public_idx").on(
      table.novelId,
      table.isPublic,
      table.updatedAt,
    ),
  ],
);

export const NovelSettingsTable = sqliteTable("novel_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: text("theme", { enum: NOVEL_READER_THEMES })
    .notNull()
    .default("light"),
  fontSize: integer("font_size").notNull().default(18),
  lineHeight: real("line_height").notNull().default(1.8),
  fontFamily: text("font_family", { enum: NOVEL_FONT_FAMILIES })
    .notNull()
    .default("serif"),
  updatedAt,
});

export type Novel = typeof NovelsTable.$inferSelect;
export type NovelChapter = typeof NovelChaptersTable.$inferSelect;
export type NovelProgress = typeof NovelProgressTable.$inferSelect;
export type NovelNote = typeof NovelNotesTable.$inferSelect;
export type NovelSettings = typeof NovelSettingsTable.$inferSelect;
export type NovelStatus = (typeof NOVEL_STATUSES)[number];
export type NovelSource = (typeof NOVEL_SOURCES)[number];
export type NovelFileFormat = (typeof NOVEL_FILE_FORMATS)[number];
export type NovelReaderTheme = (typeof NOVEL_READER_THEMES)[number];
export type NovelFontFamily = (typeof NOVEL_FONT_FAMILIES)[number];
