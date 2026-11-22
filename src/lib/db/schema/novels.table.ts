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
  NOVEL_NOTE_STATUSES,
  NOVEL_READER_THEMES,
  NOVEL_READING_MODES,
  NOVEL_REPORT_STATUSES,
  NOVEL_SOURCES,
  NOVEL_STATUSES,
  NOVEL_VOTE_CHOICES,
} from "../../enum-values";

export {
  NOVEL_FILE_FORMATS,
  NOVEL_FONT_FAMILIES,
  NOVEL_NOTE_STATUSES,
  NOVEL_READER_THEMES,
  NOVEL_READING_MODES,
  NOVEL_REPORT_STATUSES,
  NOVEL_SOURCES,
  NOVEL_STATUSES,
  NOVEL_VOTE_CHOICES,
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
    /** Bumped on edit, so a concurrent edit is detected rather than overwritten. */
    version: integer().notNull().default(0),
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
    /** A highlight the Admin removed stays, but no longer shows publicly. */
    status: text("status", { enum: NOVEL_NOTE_STATUSES })
      .notNull()
      .default("visible"),
    /** Pending reports, kept so a threshold can be checked without a count. */
    reportCount: integer("report_count").notNull().default(0),
    removedBy: text("removed_by"),
    removedAt: integer("removed_at", { mode: "timestamp" }),
    removeReason: text("remove_reason"),
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
  /** The reading column's widest measure, in pixels. */
  pageWidth: integer("page_width").notNull().default(720),
  readingMode: text("reading_mode", { enum: NOVEL_READING_MODES })
    .notNull()
    .default("scroll"),
  updatedAt,
});

/** One chapter a reader marked to come back to. */
export const NovelBookmarksTable = sqliteTable(
  "novel_bookmarks",
  {
    id,
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    novelId: integer("novel_id")
      .notNull()
      .references(() => NovelsTable.id, { onDelete: "cascade" }),
    chapterOrder: integer("chapter_order").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("novel_bookmarks_unique_idx").on(
      table.userId,
      table.novelId,
      table.chapterOrder,
    ),
    index("novel_bookmarks_user_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * Reading time per reader, book and UTC day. The reader heartbeats while a
 * chapter is open, and the day's row grows by the seconds and words read.
 */
export const NovelReadingDailyTable = sqliteTable(
  "novel_reading_daily",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    novelId: integer("novel_id")
      .notNull()
      .references(() => NovelsTable.id, { onDelete: "cascade" }),
    /** The UTC day, `YYYY-MM-DD`. */
    day: text().notNull(),
    seconds: integer().notNull().default(0),
    words: integer().notNull().default(0),
    chapters: integer().notNull().default(0),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.novelId, table.day] }),
    index("novel_reading_daily_novel_idx").on(table.novelId, table.day),
  ],
);

/** A shelf tag, shared by every book. */
export const NovelTagsTable = sqliteTable(
  "novel_tags",
  {
    id,
    name: text().notNull(),
    slug: text().notNull(),
    createdAt,
  },
  (table) => [uniqueIndex("novel_tags_slug_idx").on(table.slug)],
);

export const NovelTagLinksTable = sqliteTable(
  "novel_tag_links",
  {
    novelId: integer("novel_id")
      .notNull()
      .references(() => NovelsTable.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => NovelTagsTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.novelId, table.tagId] }),
    index("novel_tag_links_tag_idx").on(table.tagId),
  ],
);

export const NovelNoteLikesTable = sqliteTable(
  "novel_note_likes",
  {
    noteId: integer("note_id")
      .notNull()
      .references(() => NovelNotesTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.userId] }),
    index("novel_note_likes_user_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * A report against a shared highlight. A visitor without an account may
 * report too, so `reporterKey` is `user:<id>`, `anon:<uuid>` or `ip:<hash>`.
 */
export const NovelNoteReportsTable = sqliteTable(
  "novel_note_reports",
  {
    id,
    noteId: integer("note_id")
      .notNull()
      .references(() => NovelNotesTable.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reporterKey: text("reporter_key").notNull(),
    reason: text().notNull().default(""),
    status: text("status", { enum: NOVEL_REPORT_STATUSES })
      .notNull()
      .default("pending"),
    createdAt,
  },
  (table) => [
    index("novel_note_reports_note_idx").on(table.noteId, table.status),
    uniqueIndex("novel_note_reports_unique_idx").on(
      table.noteId,
      table.reporterKey,
    ),
  ],
);

/** A signed-in reader's vote on whether a reported highlight is removed. */
export const NovelNoteVotesTable = sqliteTable(
  "novel_note_votes",
  {
    noteId: integer("note_id")
      .notNull()
      .references(() => NovelNotesTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    choice: text("choice", { enum: NOVEL_VOTE_CHOICES }).notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.userId] }),
    index("novel_note_votes_choice_idx").on(table.noteId, table.choice),
  ],
);

/** A moderation point a reader earned or lost, shown on their profile. */
export const NovelScoreLogsTable = sqliteTable(
  "novel_score_logs",
  {
    id,
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    delta: real().notNull(),
    reason: text().notNull(),
    createdAt,
  },
  (table) => [
    index("novel_score_logs_user_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * A mute earned by a report upheld against the reader. The level steps
 * 1 → 2 → 3 days and then 30 days, then permanent (`until` is null).
 */
export const NovelMutesTable = sqliteTable(
  "novel_mutes",
  {
    id,
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    level: integer().notNull(),
    until: integer("until", { mode: "timestamp" }),
    reason: text().notNull().default(""),
    createdAt,
  },
  (table) => [index("novel_mutes_user_idx").on(table.userId, table.createdAt)],
);

export type Novel = typeof NovelsTable.$inferSelect;
export type NovelChapter = typeof NovelChaptersTable.$inferSelect;
export type NovelProgress = typeof NovelProgressTable.$inferSelect;
export type NovelNote = typeof NovelNotesTable.$inferSelect;
export type NovelSettings = typeof NovelSettingsTable.$inferSelect;
export type NovelBookmark = typeof NovelBookmarksTable.$inferSelect;
export type NovelReadingDaily = typeof NovelReadingDailyTable.$inferSelect;
export type NovelTag = typeof NovelTagsTable.$inferSelect;
export type NovelNoteReport = typeof NovelNoteReportsTable.$inferSelect;
export type NovelNoteVote = typeof NovelNoteVotesTable.$inferSelect;
export type NovelStatus = (typeof NOVEL_STATUSES)[number];
export type NovelSource = (typeof NOVEL_SOURCES)[number];
export type NovelFileFormat = (typeof NOVEL_FILE_FORMATS)[number];
export type NovelReaderTheme = (typeof NOVEL_READER_THEMES)[number];
export type NovelReadingMode = (typeof NOVEL_READING_MODES)[number];
export type NovelNoteStatus = (typeof NOVEL_NOTE_STATUSES)[number];
export type NovelVoteChoice = (typeof NOVEL_VOTE_CHOICES)[number];
export type NovelFontFamily = (typeof NOVEL_FONT_FAMILIES)[number];
